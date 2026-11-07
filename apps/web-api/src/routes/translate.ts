import {
  checkTranslationQuota,
  classifyInput,
  detectLanguageWithConfidence,
  type Example,
  errorFields,
  isSupported,
  logEvent,
  resolveDirectionFromSource,
  resolveOutputConfig,
  resolveTranslationDirection,
  type TranslateOutput,
  toVocabularyInput,
  translateWithContext,
  type User,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

/** Matches the bot's budget so one word costs the same wait in either channel. */
const TRANSLATION_BUDGET_MS = 87_000;

const bodySchema = z.object({ text: z.string().trim().min(1).max(200) });

class TranslationTimeout extends Error {}

async function resolveModel(services: WebServices, plan: string): Promise<string> {
  const model =
    (await services.settings.getDefaultAIModelForPlan(plan)) ?? (await services.settings.getFallbackAIModel());
  if (!model) throw new Error("No AI model configured");
  return model;
}

/**
 * Sync detection only (script, diacritics, franc). The bot escalates doubtful
 * input to a dictionary/AI arbitration and asks the user; the web has no
 * question-and-answer loop yet, so a doubtful word takes the same fallback
 * direction the bot uses when it cannot ask.
 */
function resolveDirection(text: string, nativeLang: string, learningLangs: string[]) {
  const detection = detectLanguageWithConfidence(text, ["en", nativeLang, ...learningLangs]);
  const direction = detection.language
    ? resolveDirectionFromSource({ sourceLang: detection.language, nativeLang, learningLangs })
    : null;
  if (direction) return direction;
  if (detection.language === "en") {
    return { sourceLang: "en", targetLangs: [nativeLang, ...learningLangs.filter((code) => code !== "en")] };
  }
  return resolveTranslationDirection({ text, nativeLang, learningLangs });
}

/** The bot's Save button, minus the card: re-link an existing entry, else create it, always in the default dictionary. */
async function saveToDictionary(
  services: WebServices,
  userId: number,
  output: TranslateOutput,
  inputType: "word" | "phrase" | "sentence",
): Promise<number | null> {
  const sourceLang = services.languageCache.getLang(output.sourceLang);
  if (!sourceLang) return null;
  const existing = await services.vocabularyRepository.findByOriginalAndSource(userId, output.original, sourceLang.id);
  if (existing) {
    // A word the user removed earlier comes back on a new translation, as the bot's Save restores it.
    if (!existing.isActive) await services.vocabularyRepository.restore(existing.id, userId);
    if (!(await services.vocabularyDictionaryRepository.entryBelongsToDefault(userId, existing.id))) {
      await services.vocabularyDictionaryRepository.addEntryToDefault(userId, existing.id);
    }
    return existing.id;
  }
  const input = toVocabularyInput(
    output,
    sourceLang.id,
    inputType,
    (code) => services.languageCache.getLang(code)?.id ?? null,
  );
  const created = await services.vocabularyRepository.create(userId, input);
  await services.vocabularyDictionaryRepository.addEntryToDefault(userId, created.id);
  logEvent("vocabulary.saved", {
    entryId: created.id,
    word: output.original,
    sourceLang: output.sourceLang,
    inputType,
    channel: "web",
  });
  return created.id;
}

async function translate(services: WebServices, user: User, text: string) {
  const settings = await services.userRepository.getSettings(user.id);
  const interfaceLang = settings?.interfaceLang ?? "en";
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = (settings?.learningLangs ?? []).filter((code) => code !== nativeLang);
  if (learningLangs.length === 0) return { status: "no_languages" as const };

  const { sourceLang, targetLangs } = resolveDirection(text, nativeLang, learningLangs);
  const classification = classifyInput(text);
  const [model, template] = await Promise.all([
    resolveModel(services, user.subscriptionPlan),
    services.translationTemplateRepository.getByUserId(user.id),
  ]);
  const userTpl = template ? { name: template.name, fields: template.fields } : null;
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const decision = await Promise.race([
    translateWithContext(
      {
        word: text,
        sourceLang,
        targetLangs,
        nativeLang,
        model,
        userId: user.id,
        interfaceLang: isSupported(interfaceLang) ? interfaceLang : "en",
        outputConfig: resolveOutputConfig(userTpl, classification.type, text.length),
        inputType: classification.type,
        correctionPolicy: { assessSourceExistence: true },
        deadlineAt: started + TRANSLATION_BUDGET_MS,
      },
      {
        lookupContext: classification.type === "sentence" ? async () => [] : services.contextLookup,
        generateObjectFn: services.ai.generateObject,
      },
    ),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TranslationTimeout()), TRANSLATION_BUDGET_MS + 3_000);
    }),
  ]).finally(() => clearTimeout(timer));

  if (decision.status === "needs_clarification") return { status: "needs_clarification" as const };
  return { status: "done" as const, output: decision.output, sourceLang, targetLangs, inputType: classification.type };
}

const texts = (items: { text: string }[] | null | undefined) => (items ?? []).map((item) => item.text);
const examples = (items: Example[] | null | undefined) =>
  (items ?? []).map((e) => ({ context: e.context, target: e.target, native: e.native ?? null }));

/** Everything the bot card shows, minus what only the bot renders (keyboards, dictionary context). */
export function toTranslateResult(
  output: TranslateOutput,
  targetLangs: string[],
  savedEntryId: number | null,
  sentence: boolean,
) {
  return {
    original: output.original,
    sourceLang: output.sourceLang,
    targetLangs,
    sentence,
    emoji: output.emoji ?? null,
    nativeMeaning: output.nativeMeaning ?? null,
    unverified: output.unverified === true,
    correction: output.correction
      ? {
          original: output.correction.original,
          corrected: output.correction.corrected,
          explanation: output.correction.explanation,
        }
      : null,
    sourceUsage: output.sourceUsage
      ? {
          headword: output.sourceUsage.headword ?? null,
          explanation: output.sourceUsage.explanation,
          synonyms: texts(output.sourceUsage.synonyms),
          examples: examples(output.sourceUsage.examples),
        }
      : null,
    translations: Object.entries(output.translations).map(([lang, t]) => ({
      lang,
      text: t.text,
      expressionType: t.expressionType ?? null,
      equivalentNote: t.equivalentNote ?? null,
      usageNote: t.usageNote ?? null,
      connotationWarning: t.connotationWarning ?? null,
      alternatives: texts(t.alternatives),
      synonyms: texts(t.synonyms),
      examples: examples(t.examples),
    })),
    savedEntryId,
  };
}

export function translateRoutes(app: FastifyInstance, services: WebServices): void {
  app.post("/api/translate", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_text" });
    const user = request.learner;

    // The same gate, window and ledger the bot's translate flow uses: a web
    // translation spends the user's one allowance, never a second one.
    const quota = await checkTranslationQuota(
      {
        settings: services.settings,
        translationRequests: services.translationRequestRepository,
        ...(services.subscriptionRepository ? { subscriptions: services.subscriptionRepository } : {}),
      },
      user,
    );
    if (!quota.ok) {
      logEvent("limit.reached", { userId: user.id, reason: quota.reason, channel: "web" });
      return reply.status(429).send({ code: "limit", reason: quota.reason, resetAt: quota.resetAt.toISOString() });
    }

    let result: Awaited<ReturnType<typeof translate>>;
    try {
      result = await translate(services, user, parsed.data.text);
    } catch (err) {
      if (err instanceof TranslationTimeout) return reply.status(504).send({ code: "timeout" });
      logEvent("translation.failed", { channel: "web", ...errorFields(err) }, "error");
      throw err;
    }
    if (result.status === "no_languages") return reply.status(422).send({ code: "no_languages" });
    if (result.status === "needs_clarification") return reply.status(422).send({ code: "needs_clarification" });

    const { output, sourceLang, targetLangs, inputType } = result;
    await services.translationRequestRepository.logTranslationRequest(
      user.id,
      parsed.data.text,
      sourceLang,
      targetLangs,
      quota.creditCost,
    );
    const savedEntryId = inputType === "sentence" ? null : await saveToDictionary(services, user.id, output, inputType);

    return toTranslateResult(output, targetLangs, savedEntryId, inputType === "sentence");
  });
}
