import { PassThrough } from "node:stream";
import {
  applyTemplateFields,
  creditEffort,
  type Example,
  errorFields,
  FEATURE_KEYS,
  isEtymologyEligible,
  isSupportedLanguage,
  logEvent,
  MAX_LEARNING_LANGS,
  resolveTemplate,
  runTranslation,
  saveTranslationToDictionary,
  type TemplateFields,
  type TranslateOutput,
  type TranslationOutcome,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { cardFeatures } from "./card-explore.js";
import { featureLocked, hasFeature } from "./learn-shared.js";
import { signSaveToken, verifySaveToken } from "./save-token.js";

const saveSchema = z.object({ token: z.string().min(1).max(200_000) });

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
  // The bot's tr:oos:add "Add and translate": join the learning set, then translate from it.
  addLanguage: z.string().min(2).max(8).optional(),
  // "Translate once": `sourceLang` from outside the learning set, for this request only — nothing is saved.
  once: z.boolean().optional(),
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

/** The fields the user's cards show: their saved template, or the default one. */
async function templateFields(services: WebServices, userId: number): Promise<TemplateFields> {
  const saved = await services.translationTemplateRepository.getByUserId(userId);
  return resolveTemplate(saved ? { name: saved.name, fields: saved.fields } : null).fields;
}

/** The entry a learner already keeps for this card — what makes a re-translated saved word show Remove, not Save. */
async function activeEntryId(services: WebServices, userId: number, output: TranslateOutput): Promise<number | null> {
  const sourceLang = services.languageCache.getLang(output.sourceLang);
  if (!sourceLang) return null;
  const existing = await services.vocabularyRepository.findByOriginalAndSource(userId, output.original, sourceLang.id);
  return existing?.isActive ? existing.id : null;
}

export function translateRoutes(app: FastifyInstance, services: WebServices, saveSecret: string): void {
  // The bot's Save button: only an explicit tap puts a word in the dictionary.
  app.post("/api/translate/save", async (request, reply) => {
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_token" });
    const user = request.learner;
    const card = verifySaveToken(saveSecret, parsed.data.token);
    if (!card || card.userId !== user.id) return reply.status(403).send({ code: "invalid_token" });
    const entryId = await saveTranslationToDictionary(
      {
        languageCache: services.languageCache,
        vocabulary: services.vocabularyRepository,
        dictionaries: services.vocabularyDictionaryRepository,
      },
      user.id,
      card.output,
      card.inputType,
      "web",
    );
    if (entryId === null) return reply.status(422).send({ code: "unsupported_language" });
    await creditEffort(services.momentumService, { userId: user.id, kind: "save", dedupeKey: `save:${entryId}` });
    return { entryId };
  });

  app.post("/api/translate", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_text" });
    const { text, clarify, addLanguage, ...answer } = parsed.data;
    const user = request.learner;
    if (addLanguage !== undefined) {
      if (!isSupportedLanguage(addLanguage)) return reply.status(400).send({ code: "invalid_language" });
      const settings = await services.userRepository.getSettings(user.id);
      const nativeLang = settings?.nativeLang ?? "en";
      const learning = (settings?.learningLangs ?? []).filter((code) => code !== nativeLang);
      if (addLanguage !== nativeLang && !learning.includes(addLanguage)) {
        if (learning.length >= MAX_LEARNING_LANGS) {
          return reply.status(422).send({ code: "max_languages", limit: MAX_LEARNING_LANGS });
        }
        await services.userRepository.updateLearningLangs(user.id, [...learning, addLanguage]);
        logEvent("language.added_from_out_of_set", { sourceLang: addLanguage, surface: "web" });
      }
      answer.sourceLang = addLanguage;
    }
    if (
      (clarify === true || answer.negativeConstraints) &&
      !(await hasFeature(services, user, FEATURE_KEYS.clarification))
    ) {
      return featureLocked(reply, FEATURE_KEYS.clarification);
    }

    // A client that sends this Accept header gets the card as it settles, one JSON
    // line per step; every other client (older pages, CardExplore) keeps one JSON reply.
    const streaming = request.headers.accept?.includes(NDJSON) === true;
    const fields = streaming ? await templateFields(services, user.id) : null;
    const stream = streaming ? new PassThrough() : null;
    // The pipeline outlives a hard timeout, so a late preview can arrive after the last line.
    const writeLine = (line: StreamLine) => {
      if (stream && !stream.writableEnded) stream.write(`${JSON.stringify(line)}\n`);
    };
    if (stream) {
      // nginx buffers proxied replies by default, which would hold every preview until the end.
      void reply
        .header("content-type", `${NDJSON}; charset=utf-8`)
        .header("cache-control", "no-store")
        .header("x-accel-buffering", "no")
        .send(stream);
    }

    let answered: Answered;
    try {
      const outcome = await runTranslation(
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
          ...(fields
            ? {
                onPreview: (partial: TranslateOutput, targetLangs: string[], sentence: boolean) =>
                  writeLine({
                    type: "preview",
                    card: toTranslateResult(applyTemplateFields(partial, fields), targetLangs, null, sentence),
                  }),
              }
            : {}),
        },
      );
      answered = await answerFor(
        services,
        saveSecret,
        user,
        outcome,
        fields ?? (await templateFields(services, user.id)),
      );
    } catch (err) {
      logEvent("translation.failed", { channel: "web", ...errorFields(err) }, "error");
      if (!stream) throw err;
      answered = { status: 500, body: { code: "internal" } };
    }

    if (!stream) return reply.status(answered.status).send(answered.body);
    // The stream's HTTP status is always 200, so the real outcome is logged here for the dashboards.
    if (answered.status !== 200)
      logEvent("translation.stream_outcome", { channel: "web", status: answered.status, code: answered.body.code });
    writeLine(answered.status === 200 ? { type: "done", card: answered.body } : { type: "error", ...answered });
    stream.end();
    return reply;
  });
}

const NDJSON = "application/x-ndjson";

type Answered = { status: number; body: Record<string, unknown> };
type StreamLine =
  | { type: "preview"; card: ReturnType<typeof toTranslateResult> }
  | { type: "done"; card: Record<string, unknown> }
  | ({ type: "error" } & Answered);

/** The reply for a finished run — the same status and body whether it goes out whole or as a stream's last line. */
async function answerFor(
  services: WebServices,
  saveSecret: string,
  user: Parameters<typeof cardFeatures>[1],
  outcome: TranslationOutcome,
  fields: TemplateFields,
): Promise<Answered> {
  switch (outcome.status) {
    case "rejected":
      return { status: 422, body: { code: "rejected", reason: outcome.reason, maxLength: outcome.maxLength } };
    case "no_languages":
      return { status: 422, body: { code: "no_languages" } };
    case "limit":
      return { status: 429, body: { code: "limit", reason: outcome.reason, resetAt: outcome.resetAt.toISOString() } };
    case "needs_language":
      return {
        status: 422,
        body: { code: "needs_language", kind: outcome.kind, text: outcome.text, languages: outcome.candidates },
      };
    case "add_language":
      return {
        status: 422,
        body: {
          code: "add_language",
          lang: outcome.lang,
          supported: outcome.supported,
          text: outcome.text,
          ...(outcome.candidates ? { languages: outcome.candidates } : {}),
        },
      };
    case "needs_clarification":
      return { status: 422, body: { code: "needs_clarification", sourceLang: outcome.sourceLang, ...outcome.view } };
    case "timeout":
      return { status: 504, body: { code: "timeout" } };
    case "no_more_meanings":
      return { status: 422, body: { code: "no_more_meanings" } };
    case "done": {
      const savedEntryId =
        outcome.inputType === "sentence" ? null : await activeEntryId(services, user.id, outcome.output);
      await creditEffort(services.momentumService, {
        userId: user.id,
        kind: "translate",
        dedupeKey: `translate:${outcome.translationRequestId}`,
      });
      const settings = await services.userRepository.getSettings(user.id);
      // The dictionary keeps the whole card; only the shown card drops what the template turns off, as the bot's does.
      const shown = applyTemplateFields(outcome.output, fields);
      return {
        status: 200,
        body: {
          ...toTranslateResult(
            shown,
            outcome.targetLangs,
            savedEntryId,
            outcome.inputType === "sentence",
            outcome.needsReview,
          ),
          inputType: outcome.inputType,
          // The full card, signed: Save stores what the dictionary keeps, not the template-trimmed view.
          saveToken:
            outcome.inputType === "sentence"
              ? null
              : signSaveToken(saveSecret, { userId: user.id, inputType: outcome.inputType, output: outcome.output }),
          context: outcome.contextHint ?? null,
          etymologyEligible: isEtymologyEligible(outcome.inputType, outcome.sourceLang, settings?.nativeLang ?? "en"),
          features: await cardFeatures(services, user),
        },
      };
    }
  }
}
