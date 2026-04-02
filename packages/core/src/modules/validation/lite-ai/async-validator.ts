/**
 * Lite AI Validation — Async Validator
 *
 * Fire-and-forget async validation trigger. Called after translate()
 * returns to the caller — the user sees their translation immediately,
 * while this runs in the background.
 *
 * Decision flow:
 * 1. If validatorModel is undefined → skip (feature disabled)
 * 2. If isHighRisk() returns false → skip (low risk)
 * 3. Otherwise → call validateWithLiteAI(), invoke onFlagged if needed
 *
 * Errors are caught and logged — never thrown to the caller.
 */

import { getLogger } from "../../../logger.js";
import { isHighRisk } from "./risk-detector.js";
import { validateWithLiteAI } from "./lite-validation.service.js";
import type { AsyncValidationParams } from "./types.js";

/**
 * Trigger async validation for a translation.
 *
 * Fire-and-forget: returns void immediately. The validation runs
 * in the background as a floating promise with error handling.
 *
 * @param params - All inputs needed for risk detection and validation
 */
export function triggerAsyncValidation(params: AsyncValidationParams): void {
  const {
    validatorModel,
    original,
    sourceLang,
    translations,
    inputType,
    dictionaryContext,
    expressionTypes,
    targetLangs,
    generateObjectFn,
    onFlagged,
  } = params;

  // Feature disabled — no validator model configured
  if (!validatorModel) {
    return;
  }

  // Check if translation is high-risk
  const highRisk = isHighRisk({
    inputType,
    dictionaryContext,
    expressionTypes,
    targetLangs,
  });

  if (!highRisk) {
    return;
  }

  const logger = getLogger();

  logger.info(
    {
      original,
      sourceLang,
      targetLangs,
      validatorModel,
      isHighRisk: true,
    },
    "async lite validation started",
  );

  // Fire-and-forget — catch all errors
  void (async () => {
    try {
      const result = await validateWithLiteAI(
        { original, sourceLang, translations, dictionaryContext },
        generateObjectFn,
        validatorModel,
      );

      if (result.flaggedForReview) {
        onFlagged(result.scores);
      }
    } catch (error) {
      logger.error(
        {
          original,
          sourceLang,
          targetLangs,
          validatorModel,
          error: error instanceof Error ? error.message : String(error),
        },
        "async lite validation unexpected error",
      );
    }
  })();
}
