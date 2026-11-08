import {
  AITimeoutError,
  type ChatMessage,
  composeCardMentorTurn,
  defaultFeatureAccess,
  errorFields,
  FEATURE_KEYS,
  generateEtymology,
  getLanguageName,
  isEtymologyEligible,
  logEvent,
  MAX_MENTOR_HISTORY,
  MENTOR_MAX_INPUT_LENGTH,
  type MentorCard,
  resolveDefaultAIModel,
  resolveFeatureStates,
  t,
  type User,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { featureLocked, hasFeature } from "./learn-shared.js";
import { answerMentorTurn, mentorHistorySchema } from "./mentor-chat.js";

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
    history: mentorHistorySchema.optional(),
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
    if (question !== undefined && question.length > MENTOR_MAX_INPUT_LENGTH) {
      return reply.status(400).send({ code: "too_long", max: MENTOR_MAX_INPUT_LENGTH });
    }
    const mentorCard = toMentorCard(card);
    const headword = card.sourceUsage?.headword?.trim() || card.original;
    let asked = question ?? "";
    const answer = await answerMentorTurn(services, request.learner, reply, (lang) => {
      asked =
        question ?? t("cardMentorQuestion", lang, { text: headword, lang: getLanguageName(card.sourceLang, lang) });
      return mentorTurns(
        (q) => composeCardMentorTurn({ output: mentorCard, ...(etymology ? { etymology } : {}) }, q),
        history,
        asked,
      );
    });
    if (answer === null) return reply;
    logEvent("card.mentor_asked", { lang: card.sourceLang, withCard: true, explain: explain === true, channel: "web" });
    return { question: asked, answer };
  });
}
