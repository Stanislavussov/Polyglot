/**
 * Async validation bridge — fires lite AI validation in the background.
 *
 * Reads `AI_MODEL_VALIDATOR` from env. If absent, validation is disabled.
 * Dynamically loads `triggerAsyncValidation` from @polyglot/core.
 * Gracefully degrades when the core function is not yet exported.
 *
 * Task 37.8 — Wire async validation in bot translate scene.
 */

import { generateObject } from "@polyglot/adapter-ai";
import type { ExpressionType, TranslateOutput } from "@polyglot/core";
import { logger } from "@polyglot/infra";

/** Parameters for firing async validation from the bot layer. */
export interface FireAsyncValidationParams {
  /** Full translate output */
  output: TranslateOutput;
  /** Classified input type */
  inputType?: "word" | "phrase" | "sentence";
  /** Target language codes */
  targetLangs: string[];
  /** DB word ID if already saved (for future markForReview wiring) */
  savedWordId?: number;
}

/**
 * Fire-and-forget async validation trigger.
 *
 * 1. If `AI_MODEL_VALIDATOR` env is absent → skip (feature disabled)
 * 2. Dynamically loads `triggerAsyncValidation` from core
 * 3. If core function not available → skip silently
 * 4. Delegates risk detection + validation to core
 * 5. On flagged → logs warning (DB markForReview pending 37.6)
 *
 * Never throws — all errors caught and logged.
 */
export function fireAsyncValidation(params: FireAsyncValidationParams): void {
  const validatorModel = process.env.AI_MODEL_VALIDATOR;
  if (!validatorModel) return;

  const { output, inputType, targetLangs, savedWordId } = params;

  // Extract expression types from translation results
  const expressionTypes: ExpressionType[] = Object.values(output.translations)
    .map((tr) => tr.expressionType)
    .filter((e): e is ExpressionType => e != null);

  void (async () => {
    try {
      // Dynamic import — gracefully handles missing export
      const core = (await import("@polyglot/core")) as Record<string, unknown>;
      if (typeof core.triggerAsyncValidation !== "function") {
        return;
      }

      core.triggerAsyncValidation({
        original: output.original,
        sourceLang: output.sourceLang,
        translations: output.translations,
        inputType,
        dictionaryContext: output.dictionaryContext,
        expressionTypes,
        targetLangs,
        validatorModel,
        generateObjectFn: generateObject,
        onFlagged: (scores: Record<string, unknown>) => {
          // TODO(37.6): Wire to vocabularyRepository.markForReview() when DB method is available
          logger.warn(
            { original: output.original, savedWordId, scores },
            "Translation flagged for review by lite AI validator",
          );
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to trigger async validation");
    }
  })();
}
