/**
 * Translation Service — the single entry point for all translation operations.
 *
 * Flow:
 * 1. Build prompt (buildTranslationPrompt)
 * 2. Call AI adapter (generateObject with translationResultSchema)
 * 3. Validate response (validate from validation module)
 * 4. On PASS → return { status: "accepted", output, quality }
 * 5. On FAIL → retry with strict prompt (up to 2 retries)
 * 6. On final FAIL → return { status: "needs_review", output, issues }
 *
 * Does NOT save results — only returns them.
 * Knows nothing about the user — works only with text and languages.
 */

import { getLogger } from "../../logger.js";
import { validate } from "../validation/index.js";
import { buildStrictPrompt, buildTranslationPrompt } from "./prompt.builder.js";
import { buildTranslationResultSchema, translationResultSchema } from "./schemas/translation.schema.js";
import type {
  LanguageTranslation,
  QualityIssue,
  TranslateInput,
  TranslateOutput,
  TranslationDecision,
  TranslationOutputConfig,
  TranslationRequest,
  TranslationResult,
} from "./types.js";

const MAX_RETRIES = 2;
const PROMPT_VERSION = "translation-v1";
const SCHEMA_VERSION = 1;

/**
 * AI generation function signature — injected to avoid direct dependency
 * on the AI adapter package from core.
 */
export type GenerateObjectFn = <T>(
  prompt: string,
  schema: import("zod").ZodSchema<T>,
  model: string,
  options?: { userId?: number; frequencyPenalty?: number },
) => Promise<T>;

/**
 * Translate a single word or phrase into multiple target languages.
 *
 * This is the main entry point for all translation operations.
 *
 * @param input - Word, source/target languages, model ID
 * @param generateObjectFn - AI generation function (injected)
 * @returns TranslationDecision — accepted, needs_clarification, or needs_review
 */
export async function translate(
  input: TranslateInput,
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationDecision> {
  const request: TranslationRequest = {
    text: input.word,
    sourceLang: input.sourceLang,
    targetLangs: input.targetLangs,
    nativeLang: input.nativeLang,
    topic: input.topic,
    dictionaryContext: input.dictionaryContext,
    outputConfig: input.outputConfig,
    inputType: input.inputType,
  };

  getLogger().info(
    {
      original: input.word,
      sourceLang: input.sourceLang,
      targetLangs: input.targetLangs,
      topic: input.topic,
      model: input.model,
    },
    "translation request started",
  );

  const requiresNativeOutput = input.nativeLang !== undefined;
  const requiresSourceUsage =
    requiresNativeOutput && input.sourceLang !== input.nativeLang && input.inputType !== "sentence";
  const requiresUsageNote =
    requiresNativeOutput && input.inputType !== "sentence" && input.outputConfig?.includeUsageNote !== false;
  const schema = buildTranslationResultSchema(
    input.targetLangs,
    input.outputConfig,
    requiresNativeOutput,
    requiresSourceUsage,
    input.nativeLang,
    requiresUsageNote,
    input.sourceLang,
  );
  let prompt = buildTranslationPrompt(request);
  let result: TranslationResult;
  let lastErrors: string[] = [];
  let attemptCount = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    attemptCount = attempt + 1;
    try {
      result = (await generateObjectFn(prompt, schema, input.model, {
        frequencyPenalty: 0,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
      })) as TranslationResult;
    } catch (generationError) {
      const errorMsg = generationError instanceof Error ? generationError.message : String(generationError);

      getLogger().warn(
        {
          original: input.word,
          retryCount: attempt,
          failReason: errorMsg,
        },
        "AI generation failed",
      );

      if (attempt === MAX_RETRIES) {
        throw generationError;
      }

      lastErrors = [`[generation] ${errorMsg}`];
      prompt = buildStrictPrompt(request, lastErrors);
      continue;
    }

    const validation = validate(result, schema, input.word, input.targetLangs, input.inputType, {
      ...input.outputConfig,
      nativeLang: input.nativeLang,
      sourceLang: input.sourceLang,
    });

    if (validation.valid) {
      return {
        status: "accepted",
        output: toOutput(input, result),
        quality: {
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          riskLevel: "low",
          modelId: input.model,
          attemptCount,
          issues: [],
        },
      };
    }

    lastErrors = validation.errors.map((e) => `[${e.rule}] ${e.field ? `${e.field}: ` : ""}${e.message}`);

    getLogger().warn(
      {
        original: input.word,
        retryCount: attempt,
        failReason: lastErrors.join(" | "),
      },
      "translation validation failed",
    );

    prompt = buildStrictPrompt(request, lastErrors);
  }

  getLogger().error(
    {
      original: input.word,
      retryCount: MAX_RETRIES,
      failReason: lastErrors.join(" | "),
    },
    "translation validation failed after all retries — returning needs_review",
  );

  const issues: QualityIssue[] = lastErrors.map((msg) => ({
    fieldPath: "",
    severity: "warning",
    message: msg,
  }));

  return {
    status: "needs_review",
    output: toOutput(input, result!),
    issues,
  };
}

/**
 * Re-translate a word for a single target language.
 *
 * Thin wrapper around translate() — calls it with targetLangs: [targetLang]
 * and extracts just the LanguageTranslation for that language.
 *
 * Used by partial regeneration — cheaper than full translate().
 *
 * @param input - Same as TranslateInput, plus a `targetLang` for the single language
 * @param generateObjectFn - AI generation function (injected)
 * @returns LanguageTranslation for the requested language
 */
export async function translateOne(
  input: TranslateInput & { targetLang: string },
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationDecision> {
  return translate(
    {
      word: input.word,
      sourceLang: input.sourceLang,
      targetLangs: [input.targetLang],
      nativeLang: input.nativeLang,
      model: input.model,
      topic: input.topic,
      userId: input.userId,
      dictionaryContext: input.dictionaryContext,
      outputConfig: input.outputConfig,
      inputType: input.inputType,
    },
    generateObjectFn,
  );
}

/**
 * Translate a batch of words into multiple target languages.
 *
 * Calls translate() for each word sequentially (not in parallel,
 * to avoid rate limiting issues with the AI provider).
 *
 * @param words - Array of words to translate
 * @param sourceLang - Source language code
 * @param targetLangs - Target language codes
 * @param model - AI model ID
 * @param generateObjectFn - AI generation function (injected)
 * @returns Array of TranslateOutput, one per word
 */
export async function translateBatch(
  words: string[],
  sourceLang: string,
  targetLangs: string[],
  model: string,
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationDecision[]> {
  const results: TranslationDecision[] = [];

  for (const word of words) {
    const decision = await translate({ word, sourceLang, targetLangs, model }, generateObjectFn);
    results.push(decision);
  }

  return results;
}

/**
 * Parse and validate a raw AI response into TranslateOutput.
 *
 * Validates the raw data against translationResultSchema,
 * returns the parsed result or throws on invalid data.
 */
export function parseResponse(raw: unknown): TranslationResult {
  return translationResultSchema.parse(raw);
}

/**
 * Build the prompt for a translation request.
 *
 * Exposed for external testing/usage.
 */
export { buildTranslationPrompt as buildPrompt } from "./prompt.builder.js";

/** Default fallback emoji when AI returns a non-emoji string */
const DEFAULT_EMOJI = "🔤";

/**
 * Check whether a string looks like an emoji (not a plain-text word).
 *
 * The AI's typical failure mode is returning a synonym ("brittle", "fragile")
 * instead of an emoji. All such words contain ASCII letters, while real emoji
 * characters (including flags 🇷🇺, ZWJ sequences 👨‍👩‍👧, keycaps 1️⃣) do not.
 */
function looksLikeEmoji(value: string): boolean {
  return value.length > 0 && !/[a-zA-Z]/.test(value);
}

/** Ensure a value is a valid emoji, falling back to a default */
export function sanitizeEmoji(value: string): string {
  return looksLikeEmoji(value) ? value : DEFAULT_EMOJI;
}

function toOutput(input: TranslateInput, result: TranslationResult): TranslateOutput {
  const translations = stripDisabledFields(result.translations, input.outputConfig);

  const emoji = sanitizeEmoji(result.emoji);
  if (emoji !== result.emoji) {
    getLogger().warn(
      { original: input.word, rawEmoji: result.emoji, sanitized: emoji },
      "AI returned non-emoji string in emoji field, replaced with fallback",
    );
  }

  const output: TranslateOutput = {
    original: input.word,
    sourceLang: input.sourceLang,
    emoji,
    ...(input.nativeLang && result.nativeMeaning ? { nativeMeaning: result.nativeMeaning } : {}),
    ...(input.nativeLang && result.sourceUsage ? { sourceUsage: result.sourceUsage } : {}),
    nativeSynonyms: input.outputConfig?.includeNativeSynonyms === false ? [] : (result.nativeSynonyms ?? []),
    translations,
  };

  if (input.dictionaryContext) {
    output.dictionaryContext = input.dictionaryContext;
  }

  return output;
}

/**
 * Strip fields that were disabled via TranslationOutputConfig.
 *
 * The AI model may return optional fields even when not asked —
 * the Zod schema describes their structure (for `.default([])`),
 * and Vercel AI SDK exposes that to the model. This function
 * enforces the caller's intent by zeroing out disabled sections.
 */
function stripDisabledFields(
  translations: Record<string, LanguageTranslation>,
  config?: TranslationOutputConfig,
): Record<string, LanguageTranslation> {
  const stripped: Record<string, import("./types.js").LanguageTranslation> = {};

  for (const [lang, lt] of Object.entries(translations)) {
    stripped[lang] = {
      ...lt,
      synonyms: config?.includeSynonyms === false ? [] : (lt.synonyms ?? []),
      examples: config?.includeExamples === false ? [] : (lt.examples ?? []),
      alternatives: config?.includeAlternatives === false ? null : (lt.alternatives ?? null),
      expressionType: config?.includeEquivalentNote === false ? null : (lt.expressionType ?? null),
      equivalentNote: config?.includeEquivalentNote === false ? null : (lt.equivalentNote ?? null),
      usageNote: config?.includeUsageNote === false ? null : (lt.usageNote ?? null),
      connotationWarning: config?.includeConnotationWarning === false ? null : (lt.connotationWarning ?? null),
    };
  }

  return stripped;
}
