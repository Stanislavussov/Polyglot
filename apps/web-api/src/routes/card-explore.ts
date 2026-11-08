import {
  AITimeoutError,
  buildAiFailover,
  buildMentorSystemPrompt,
  type ChatMessage,
  checkAiQuota,
  checkMentorDailyQuota,
  composeCardMentorTurn,
  defaultFeatureAccess,
  errorFields,
  FEATURE_KEYS,
  type FeatureKey,
  generateEtymology,
  getLanguageName,
  isEtymologyEligible,
  isSupported,
  logEvent,
  MAX_MENTOR_HISTORY,
  type MentorCard,
  type QuotaPorts,
  recordAiUsage,
  resolveDefaultAIModel,
  resolveFallbackAIModel,
  resolveFeatureStates,
  TRANSLATION_HARD_TIMEOUT_MS,
  t,
  type User,
} from "@polyglot/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

/** The bot's MENTOR_MAX_INPUT_LENGTH: what a user may type as one question. */
export const MENTOR_MAX_QUESTION_LENGTH = 1000;

export async function hasFeature(services: WebServices, user: User, feature: FeatureKey): Promise<boolean> {
  const access = services.featureAccess ?? defaultFeatureAccess;
  return (await access.checkFeatureAccess(user, feature)).hasAccess;
}

/** The card's paid actions the plan includes; the routes re-check, this only draws the locks. */
export async function cardFeatures(services: WebServices, user: User) {
  const access = services.featureAccess ?? defaultFeatureAccess;
  const { clarification, mentor, etymology } = FEATURE_KEYS;
  const states = await resolveFeatureStates(access, user, [clarification, mentor, etymology]);
  return {
    clarification: states.get(clarification) === "ok",
    mentor: states.get(mentor) === "ok",
    etymology: states.get(etymology) === "ok",
  };
}

export function featureLocked(reply: FastifyReply, feature: FeatureKey) {
  return reply.status(403).send({ code: "feature_locked", feature });
}

function quotaPorts(services: WebServices): QuotaPorts {
  return {
    settings: services.settings,
    translationRequests: services.translationRequestRepository,
    ...(services.subscriptionRepository ? { subscriptions: services.subscriptionRepository } : {}),
  };
}

const etymologyBody = z.object({
  original: z.string().trim().min(1).max(200),
  sourceLang: z.string().min(2).max(8),
  inputType: z.enum(["word", "phrase"]),
});

const text = z.string().max(2_000);
const example = z.object({ context: text, target: text, native: text.nullable() });
// The card as TranslateResult carries it; the client round-trips it because the web keeps no card state.
const cardSchema = z.object({
  original: z.string().max(500),
  sourceLang: z.string().min(2).max(8),
  nativeMeaning: text.nullable(),
  unverified: z.boolean(),
  correction: z.object({ original: text, corrected: text, explanation: text }).nullable(),
  sourceUsage: z
    .object({
      headword: text.nullable(),
      explanation: text,
      synonyms: z.array(text).max(20),
      examples: z.array(example).max(10),
    })
    .nullable(),
  translations: z
    .array(
      z.object({
        lang: z.string().min(2).max(8),
        text,
        expressionType: text.nullable(),
        equivalentNote: text.nullable(),
        usageNote: text.nullable(),
        connotationWarning: text.nullable(),
        alternatives: z.array(text).max(10),
        synonyms: z.array(text).max(20),
        examples: z.array(example).max(10),
      }),
    )
    .max(12),
});

const mentorBody = z
  .object({
    card: cardSchema,
    question: z.string().trim().min(1).optional(),
    explain: z.boolean().optional(),
    etymology: z.string().max(4_000).optional(),
    history: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8_000) }))
      .max(MAX_MENTOR_HISTORY * 2)
      .optional(),
  })
  .refine((body) => body.question !== undefined || body.explain === true);

type WebCard = z.infer<typeof cardSchema>;

const asSynonyms = (items: string[]) => items.map((item) => ({ text: item }));

/** The web card rebuilt into the shape the mentor context reads, so both channels describe a card alike. */
function toMentorCard(card: WebCard): MentorCard {
  return {
    original: card.original,
    sourceLang: card.sourceLang,
    ...(card.nativeMeaning ? { nativeMeaning: card.nativeMeaning } : {}),
    ...(card.unverified ? { unverified: true } : {}),
    ...(card.correction ? { correction: card.correction } : {}),
    ...(card.sourceUsage
      ? {
          sourceUsage: {
            headword: card.sourceUsage.headword,
            explanation: card.sourceUsage.explanation,
            synonyms: asSynonyms(card.sourceUsage.synonyms),
            examples: card.sourceUsage.examples,
          },
        }
      : {}),
    nativeSynonyms: [],
    translations: Object.fromEntries(
      card.translations.map((tr) => [
        tr.lang,
        {
          text: tr.text,
          synonyms: asSynonyms(tr.synonyms),
          examples: tr.examples,
          expressionType: tr.expressionType,
          equivalentNote: tr.equivalentNote,
          usageNote: tr.usageNote,
          connotationWarning: tr.connotationWarning,
          alternatives: tr.alternatives.map((alt) => ({ text: alt, synonyms: [] })),
        },
      ]),
    ),
  };
}

/**
 * The thread the model reads: the card rides on the oldest user turn still in the
 * window, so a follow-up keeps the context without the client ever holding it.
 */
function mentorTurns(cardText: (question: string) => string, history: ChatMessage[], question: string): ChatMessage[] {
  const asked: ChatMessage = { role: "user", content: question };
  const turns = [...history, asked].slice(-MAX_MENTOR_HISTORY);
  const first = turns.findIndex((turn) => turn.role === "user");
  return turns.map(
    (turn, index): ChatMessage => (index === first ? { role: "user", content: cardText(turn.content) } : turn),
  );
}

export function cardExploreRoutes(app: FastifyInstance, services: WebServices): void {
  app.post("/api/translate/etymology", async (request, reply) => {
    const parsed = etymologyBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_card" });
    const user = request.learner;
    if (!(await hasFeature(services, user, FEATURE_KEYS.etymology)))
      return featureLocked(reply, FEATURE_KEYS.etymology);

    const settings = await services.userRepository.getSettings(user.id);
    const nativeLang = settings?.nativeLang ?? "en";
    const { original, sourceLang, inputType } = parsed.data;
    if (!isEtymologyEligible(inputType, sourceLang, nativeLang))
      return reply.status(422).send({ code: "not_eligible" });

    try {
      const model = await resolveDefaultAIModel(services.settings, user.subscriptionPlan);
      const etymology = await generateEtymology(
        { originalText: original, sourceLang, nativeLang, inputType },
        services.ai.generateObject,
        model,
        user.id,
      );
      return { etymology };
    } catch (err) {
      logEvent("card.etymology_failed", { word: original, channel: "web", ...errorFields(err) }, "error");
      return reply.status(err instanceof AITimeoutError ? 504 : 502).send({ code: "etymology_failed" });
    }
  });

  app.post("/api/mentor", async (request, reply) => {
    const parsed = mentorBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_question" });
    const { card, question, explain, etymology, history = [] } = parsed.data;
    if (question !== undefined && question.length > MENTOR_MAX_QUESTION_LENGTH) {
      return reply.status(400).send({ code: "too_long", max: MENTOR_MAX_QUESTION_LENGTH });
    }
    const user = request.learner;
    if (!(await hasFeature(services, user, FEATURE_KEYS.mentor))) return featureLocked(reply, FEATURE_KEYS.mentor);

    // Metered before the paid call, in the bot's order: the per-plan daily cap, then the credit meter.
    const ports = quotaPorts(services);
    const daily = await checkMentorDailyQuota(ports, user);
    if (!daily.ok) {
      logEvent("limit.reached", { userId: user.id, reason: "mentor", channel: "web" });
      return reply.status(429).send({ code: "mentor_limit", limit: daily.limit });
    }
    const quota = await checkAiQuota(ports, user, "mentor");
    if (!quota.ok) {
      logEvent("limit.reached", { userId: user.id, reason: quota.reason, channel: "web" });
      return reply.status(429).send({ code: "limit", reason: quota.reason, resetAt: quota.resetAt.toISOString() });
    }

    const settings = await services.userRepository.getSettings(user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = isSupported(iLang) ? iLang : "en";
    const mentorConfig = await services.settings.getMentorConfig();
    const overrideModel = mentorConfig.modelId.trim();
    const [model, fallbackModel, levelRows] = await Promise.all([
      overrideModel ? Promise.resolve(overrideModel) : resolveDefaultAIModel(services.settings, user.subscriptionPlan),
      resolveFallbackAIModel(services.settings),
      services.userRepository.getLanguageLevels(user.id),
    ]);
    const systemPrompt = buildMentorSystemPrompt({
      nativeLang: settings?.nativeLang ?? "en",
      learningLangs: settings?.learningLangs ?? [],
      levels: Object.fromEntries(levelRows.map((row) => [row.languageCode, row.proficiencyLevel])),
      interfaceLang: lang,
    });

    const mentorCard = toMentorCard(card);
    const headword = card.sourceUsage?.headword?.trim() || card.original;
    const asked =
      question ?? t("cardMentorQuestion", lang, { text: headword, lang: getLanguageName(card.sourceLang, lang) });
    const turns = mentorTurns(
      (q) => composeCardMentorTurn({ output: mentorCard, ...(etymology ? { etymology } : {}) }, q),
      history,
      asked,
    );

    try {
      const answer = await services.ai.generateChat([{ role: "system", content: systemPrompt }, ...turns], model, {
        maxTokens: mentorConfig.maxTokens,
        userId: user.id,
        budgetMs: TRANSLATION_HARD_TIMEOUT_MS,
        failover: buildAiFailover(TRANSLATION_HARD_TIMEOUT_MS, fallbackModel),
      });
      await recordAiUsage(ports, user.id, "mentor", quota.creditCost);
      logEvent("card.mentor_asked", {
        lang: card.sourceLang,
        withCard: true,
        explain: explain === true,
        channel: "web",
      });
      return { question: asked, answer };
    } catch (err) {
      logEvent("mentor.failed", { channel: "web", ...errorFields(err) }, "error");
      return reply.status(err instanceof AITimeoutError ? 504 : 502).send({ code: "mentor_failed" });
    }
  });
}
