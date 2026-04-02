/**
 * Lite AI Validation — Service
 *
 * Core service that calls the lite AI model, parses the structured
 * scoring response, and returns a LiteValidationResult.
 *
 * Uses dependency injection for the AI generation function — core
 * never depends on the AI adapter directly.
 *
 * On failure: logs warning, returns empty scores with flaggedForReview=false
 * (graceful degradation — never blocks the user).
 */

import type { ZodSchema } from "zod";
import { getLogger } from "../../../logger.js";
import { buildLiteValidationPrompt } from "./prompt.builder.js";
import { REVIEW_THRESHOLD, liteValidationResultSchema } from "./schemas.js";
import type { LiteValidationInput, LiteValidationResult, LiteValidationScore } from "./types.js";

/** AI generation function signature for lite validation */
export type LiteGenerateObjectFn = <T>(
  prompt: string,
  schema: ZodSchema<T>,
  model: string,
  options?: { maxRetries?: number },
) => Promise<T>;

/**
 * Validate translations using a lightweight AI model.
 *
 * Builds a validation prompt, calls the AI, parses the structured
 * scoring response, and determines whether the translation should
 * be flagged for review.
 *
 * @param input - Original text, translations, and context
 * @param generateObjectFn - AI generation function (injected)
 * @param model - Validator model ID (e.g. "google/gemini-2.5-flash-lite")
 * @returns LiteValidationResult with scores and review flag
 */
export async function validateWithLiteAI(
  input: LiteValidationInput,
  generateObjectFn: LiteGenerateObjectFn,
  model: string,
): Promise<LiteValidationResult> {
  const logger = getLogger();
  const startTime = Date.now();

  try {
    // Build the validation prompt
    const prompt = buildLiteValidationPrompt(input);

    // Call AI with no retries (validation is best-effort)
    const raw = await generateObjectFn(
      prompt,
      liteValidationResultSchema,
      model,
      { maxRetries: 0 },
    );

    const scores = raw.scores;
    const flaggedForReview = isFlagged(scores);
    const latencyMs = Date.now() - startTime;

    // Structured logging (Pino-compatible)
    const logFields = {
      original: input.original,
      sourceLang: input.sourceLang,
      targetLangs: Object.keys(input.translations),
      validatorModel: model,
      overallScores: extractOverallScores(scores),
      flaggedForReview,
      latencyMs,
    };

    if (flaggedForReview) {
      logger.warn(logFields, "lite validation flagged translation for review");
    } else {
      logger.info(logFields, "lite validation completed");
    }

    return { scores, flaggedForReview };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    logger.error(
      {
        original: input.original,
        sourceLang: input.sourceLang,
        targetLangs: Object.keys(input.translations),
        validatorModel: model,
        latencyMs,
        error: error instanceof Error ? error.message : String(error),
      },
      "lite validation failed — skipping gracefully",
    );

    // Graceful degradation: return empty result, don't flag
    return { scores: {}, flaggedForReview: false };
  }
}

/**
 * Determine if any language score triggers the review flag.
 * Pure function.
 */
function isFlagged(scores: Record<string, LiteValidationScore>): boolean {
  return Object.values(scores).some(
    (score) => score.overallScore < REVIEW_THRESHOLD,
  );
}

/**
 * Extract overall scores for logging.
 * Pure function.
 */
function extractOverallScores(
  scores: Record<string, LiteValidationScore>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [lang, score] of Object.entries(scores)) {
    result[lang] = score.overallScore;
  }
  return result;
}
