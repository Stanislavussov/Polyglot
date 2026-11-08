import {
  creditEffort,
  type Example,
  errorFields,
  FEATURE_KEYS,
  isEtymologyEligible,
  logEvent,
  runTranslation,
  saveTranslationToDictionary,
  type TranslateOutput,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { cardFeatures, featureLocked, hasFeature } from "./card-explore.js";

const bodySchema = z.object({
  // Generous on purpose: the length rule (and its message) belongs to core's input validation.
  text: z.string().max(2_000),
  // Set by the answer to a question, as the bot's buttons do: a chosen source
  // language, "translate as written", or a chosen meaning.
  sourceLang: z.string().min(2).max(8).optional(),
  asWritten: z.boolean().optional(),
  context: z.string().trim().min(1).max(200).optional(),
  // "Clarify translation" on a shown card: the same re-run as an answered question, but a paid card action.
  clarify: z.boolean().optional(),
  // "Other meaning": every translation shown so far, per target language, for the new card to avoid.
  negativeConstraints: z.record(z.string().min(2).max(8), z.array(z.string().max(500)).max(20)).optional(),
});

const texts = (items: { text: string }[] | null | undefined) => (items ?? []).map((item) => item.text);
const examples = (items: Example[] | null | undefined) =>
  (items ?? []).map((e) => ({ context: e.context, target: e.target, native: e.native ?? null }));

/** Everything the bot card shows, minus what only the bot renders (keyboards, dictionary context). */
export function toTranslateResult(
  output: TranslateOutput,
  targetLangs: string[],
  savedEntryId: number | null,
  sentence: boolean,
  needsReview = false,
) {
  return {
    original: output.original,
    sourceLang: output.sourceLang,
    targetLangs,
    sentence,
    emoji: output.emoji ?? null,
    nativeMeaning: output.nativeMeaning ?? null,
    unverified: output.unverified === true || needsReview,
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
    const { text, clarify, ...answer } = parsed.data;
    const user = request.learner;
    if (
      (clarify === true || answer.negativeConstraints) &&
      !(await hasFeature(services, user, FEATURE_KEYS.clarification))
    ) {
      return featureLocked(reply, FEATURE_KEYS.clarification);
    }

    let outcome: Awaited<ReturnType<typeof runTranslation>>;
    try {
      outcome = await runTranslation(
        { user, text, channel: "web", ...(Object.keys(answer).length > 0 ? { answer } : {}) },
        {
          settings: services.settings,
          users: services.userRepository,
          translationRequests: services.translationRequestRepository,
          ...(services.subscriptionRepository ? { subscriptions: services.subscriptionRepository } : {}),
          templates: services.translationTemplateRepository,
          ai: services.ai,
          contextLookup: services.contextLookup,
          wordLanguageSweep: services.wordLanguageSweep,
          languageDetections: services.languageDetectionRepository,
        },
      );
    } catch (err) {
      logEvent("translation.failed", { channel: "web", ...errorFields(err) }, "error");
      throw err;
    }

    switch (outcome.status) {
      case "rejected":
        return reply.status(422).send({ code: "rejected", reason: outcome.reason, maxLength: outcome.maxLength });
      case "no_languages":
        return reply.status(422).send({ code: "no_languages" });
      case "limit":
        return reply
          .status(429)
          .send({ code: "limit", reason: outcome.reason, resetAt: outcome.resetAt.toISOString() });
      case "needs_language":
        return reply
          .status(422)
          .send({ code: "needs_language", kind: outcome.kind, text: outcome.text, languages: outcome.candidates });
      case "add_language":
        return reply
          .status(422)
          .send({ code: "add_language", lang: outcome.lang, supported: outcome.supported, text: outcome.text });
      case "needs_clarification":
        return reply.status(422).send({ code: "needs_clarification", sourceLang: outcome.sourceLang, ...outcome.view });
      case "timeout":
        return reply.status(504).send({ code: "timeout" });
      case "no_more_meanings":
        return reply.status(422).send({ code: "no_more_meanings" });
      case "done": {
        // The web's save policy: every word or phrase lands in the dictionary; a sentence is not a word to learn.
        const savedEntryId =
          outcome.inputType === "sentence"
            ? null
            : await saveTranslationToDictionary(
                {
                  languageCache: services.languageCache,
                  vocabulary: services.vocabularyRepository,
                  dictionaries: services.vocabularyDictionaryRepository,
                },
                user.id,
                outcome.output,
                outcome.inputType,
                "web",
              );
        // The bot's credits for the same two efforts, under the same dedupe keys.
        await creditEffort(services.momentumService, {
          userId: user.id,
          kind: "translate",
          dedupeKey: `translate:${outcome.translationRequestId}`,
        });
        if (savedEntryId !== null) {
          await creditEffort(services.momentumService, {
            userId: user.id,
            kind: "save",
            dedupeKey: `save:${savedEntryId}`,
          });
        }
        const settings = await services.userRepository.getSettings(user.id);
        return {
          ...toTranslateResult(
            outcome.output,
            outcome.targetLangs,
            savedEntryId,
            outcome.inputType === "sentence",
            outcome.needsReview,
          ),
          inputType: outcome.inputType,
          context: outcome.contextHint ?? null,
          etymologyEligible: isEtymologyEligible(outcome.inputType, outcome.sourceLang, settings?.nativeLang ?? "en"),
          features: await cardFeatures(services, user),
        };
      }
    }
  });
}
