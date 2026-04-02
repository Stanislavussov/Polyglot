/**
 * Lite AI Validation — Zod Schemas
 *
 * Zod schemas for the structured scoring output from the lite AI validator.
 * Used both for AI response parsing (generateObject) and for unit testing.
 *
 * Pure definitions — no runtime, no I/O.
 */

import { z } from "zod";

/** Score range 0–5, integer */
const scoreField = z.number().int().min(0).max(5);

/** Zod schema for a single language's validation score */
export const liteValidationScoreSchema = z.object({
  meaningPreserved: scoreField,
  naturalness: scoreField,
  registerAccuracy: scoreField,
  cefrAccuracy: scoreField,
  overallScore: scoreField,
  reasoning: z.string().min(1),
});

/**
 * Zod schema for the full lite validation result.
 * Scores are keyed by language code.
 */
export const liteValidationResultSchema = z.object({
  scores: z.record(z.string(), liteValidationScoreSchema),
});

/** Threshold below which a translation is flagged for review */
export const REVIEW_THRESHOLD = 3;
