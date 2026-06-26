import { z } from "zod";

export const preflightOutcomeSchema = z.enum([
  "proceed",
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

export const preflightResultSchema = z.object({
  confidence: z.number().min(0).max(1),
  outcome: preflightOutcomeSchema,
  reasonCode: preflightReasonCodeSchema,
  explanation: z.string().min(1),
  options: z.array(preflightOptionSchema).default([]),
});

export type PreflightResult = z.infer<typeof preflightResultSchema>;
