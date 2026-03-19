import { z } from 'zod';

export const idiomClassificationSchema = z.enum([
  'CORRECT_IDIOMATIC_TRANSLATION',
  'LITERAL_BUT_UNNATURAL',
  'INCORRECT_MEANING',
]);

export const sourceExpressionTypeSchema = z.enum([
  'idiom',
  'proverb',
  'slang',
  'figurative',
  'fixed_expression',
]);

export const idiomAnalysisResultSchema = z.object({
  sourceIsIdiomatic: z.boolean(),
  sourceExpressionType: sourceExpressionTypeSchema.optional(),
  sourceLiteralMeaning: z.string().optional(),
  sourceIntendedMeaning: z.string(),

  classification: idiomClassificationSchema,
  confidence: z.number().min(0).max(1),

  toneMatch: z.boolean(),
  intensityMatch: z.boolean(),

  explanation: z.string(),

  suggestedAlternative: z.string().optional(),
  alternativeExplanation: z.string().optional(),
});

export type IdiomAnalysisResultSchema = z.infer<typeof idiomAnalysisResultSchema>;
