import { z } from "zod";

export const preflightOutcomeSchema = z.enum([
  "proceed",
  "proceed_with_correction",
  "clarify_source_language",
  "clarify_meaning",
  "confirm_typo_suggestion",
  "clarify_format",
  "reject",
]);

export const preflightReasonCodeSchema = z.enum([
  "homograph_across_languages",
  "multiple_word_senses",
  "probable_typo",
  "ambiguous_date",
  "mixed_scripts",
  "unsupported_input",
  "low_confidence",
]);

export const preflightOptionKindSchema = z.enum([
  "source_language",
  "meaning",
  "typo_correction",
  "format",
  "translate_as_written",
]);

export const preflightOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  kind: preflightOptionKindSchema,
  langCode: z.string().min(2).max(12).optional(),
  correctedText: z.string().min(1).optional(),
});

/** Cap on the preflight explanation so it fits a single annotation line. */
export const PREFLIGHT_EXPLANATION_MAX = 240;

export const preflightResultSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    outcome: preflightOutcomeSchema,
    reasonCode: preflightReasonCodeSchema,
    explanation: z.string().min(1).max(PREFLIGHT_EXPLANATION_MAX),
    /**
     * Corrected input text — REQUIRED for `proceed_with_correction`, where the
     * pipeline silently translates it. Ignored for other outcomes (typo
     * candidates for `confirm_typo_suggestion` travel in `options`).
     */
    correctedText: z.string().min(1).optional(),
    options: z.array(preflightOptionSchema).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === "proceed_with_correction" && !value.correctedText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctedText"],
        message: "correctedText is required when outcome is proceed_with_correction",
      });
    }
  });

export type PreflightResult = z.infer<typeof preflightResultSchema>;
