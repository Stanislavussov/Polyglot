/**
 * Translation Service — the single entry point for all translation operations.
 *
 * Flow (per tech-reqs/07-ai-validation.md):
 * 1. Build prompt (buildTranslationPrompt)
 * 2. Call AI adapter (generateObject with translationResultSchema)
 * 3. Validate response (validate from validation module)
 * 4. On PASS → return result
 * 5. On FAIL → retry with strict prompt (up to 2 retries)
 * 6. On final FAIL → return result with needsReview: true
 *
 * Does NOT save results — only returns them.
 * Knows nothing about the user — works only with text and languages.
 */
import type {
  TranslateInput,
  TranslateOutput,
  TranslationRequest,
  TranslationResult,
} from "./types.js";
import { buildTranslationPrompt, buildStrictPrompt } from "./prompt.builder.js";
import { translationResultSchema } from "./schemas/translation.schema.js";
import { validate } from "../validation/index.js";

/** Maximum number of validation retries before returning with needsReview */
const MAX_RETRIES = 2;

/**
 * AI generation function signature — injected to avoid direct dependency
 * on the AI adapter package from core.
 */
export type GenerateObjectFn = <T>(
  prompt: string,
  schema: import("zod").ZodSchema<T>,
  model: string,
) => Promise<T>;

/**
 * Translate a single word or phrase into multiple target languages.
 *
 * This is the main entry point for all translation operations.
 *
 * @param input - Word, source/target languages, model ID
 * @param generateObjectFn - AI generation function (injected)
 * @returns TranslateOutput with translations for all requested languages
 */
export async function translate(
  input: TranslateInput,
  generateObjectFn: GenerateObjectFn,
): Promise<TranslateOutput> {
  const request: TranslationRequest = {
    text: input.word,
    sourceLang: input.sourceLang,
    targetLangs: input.targetLangs,
    topic: input.topic,
  };

  // Step 1: Build prompt and call AI
  let prompt = buildTranslationPrompt(request);
  let result: TranslationResult;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Step 2: Call AI adapter
    result = await generateObjectFn(
      prompt,
      translationResultSchema,
      input.model,
    );

    // Step 3: Validate response
    const validation = validate(
      result,
      translationResultSchema,
      input.word,
      input.targetLangs,
    );

    // Step 4: On PASS → return result
    if (validation.valid) {
      return toOutput(input, result, false);
    }

    // Step 5: On FAIL → retry with strict prompt
    lastErrors = validation.errors.map(
      (e) => `[${e.rule}] ${e.field ? `${e.field}: ` : ""}${e.message}`,
    );

    // Build strict prompt for next retry
    prompt = buildStrictPrompt(request, lastErrors);
  }

  // Step 6: On final FAIL → return with needsReview: true
  return toOutput(input, result!, true);
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
): Promise<TranslateOutput[]> {
  const results: TranslateOutput[] = [];

  for (const word of words) {
    const output = await translate(
      { word, sourceLang, targetLangs, model },
      generateObjectFn,
    );
    results.push(output);
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

/** Convert AI result to the public TranslateOutput format */
function toOutput(
  input: TranslateInput,
  result: TranslationResult,
  needsReview: boolean,
): TranslateOutput {
  const output: TranslateOutput = {
    original: input.word,
    sourceLang: input.sourceLang,
    emoji: result.emoji,
    register: result.register,
    translations: result.translations,
  };

  if (needsReview) {
    output.needsReview = true;
  }

  return output;
}
