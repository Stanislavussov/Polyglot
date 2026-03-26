/**
 * Zod schemas for translation request and AI response.
 *
 * translationResultSchema is the single source of truth —
 * prompt output and TypeScript types are derived from it.
 */
import { z } from "zod";
import type { TranslationOutputConfig } from "../types.js";

/** Valid register values */
const registerEnum = z.enum([
  "slang",
  "colloquial",
  "neutral",
  "literary",
  "professional",
]);

/** Valid CEFR levels */
const cefrEnum = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);

/** Valid example context types */
const exampleContextEnum = z.enum(["formal", "colloquial", "professional"]);

/** Valid expression type values */
const expressionTypeEnum = z.enum(["literal", "idiomatic_equivalent"]);

/** Zod schema for a synonym */
export const synonymSchema = z.object({
  text: z.string().min(1, "Synonym text is required"),
  register: registerEnum,
});

/** Zod schema for an example sentence */
export const exampleSchema = z.object({
  context: exampleContextEnum,
  target: z.string().min(1, "Example target sentence is required"),
  native: z.string().min(1, "Example native sentence is required"),
});

/** Zod schema for a translation variant (alternative translation) */
export const translationVariantSchema = z.object({
  text: z.string().min(1, "Variant text is required"),
  register: registerEnum,
  synonyms: z.array(synonymSchema),
});

/** Zod schema for a single language translation */
export const languageTranslationSchema = z.object({
  text: z.string().min(1, "Translation text is required"),
  cefr: cefrEnum,
  transcription: z.string().optional(),
  register: registerEnum,
  synonyms: z.array(synonymSchema),
  examples: z.array(exampleSchema).min(1, "At least one example is required"),
  expressionType: expressionTypeEnum.optional().default("literal"),
  equivalentNote: z.string().optional(),
  alternatives: z.array(translationVariantSchema).optional(),
});

/** Zod schema for validating a translation request */
export const translationRequestSchema = z.object({
  text: z.string().min(1, "Text is required"),
  sourceLang: z.string().min(2, "Source language is required"),
  targetLangs: z
    .array(z.string().min(2))
    .min(1, "At least one target language is required")
    .max(4, "Maximum 4 target languages allowed"),
  topic: z.string().optional(),
});

/**
 * Zod schema for the full AI translation result.
 * Matches BRD § 10 AI Response Schema.
 *
 * Structure:
 * {
 *   emoji: "🩺",
 *   register: "neutral",
 *   translations: {
 *     "cs": { text, cefr, transcription?, register, synonyms, examples },
 *     "en": { text, cefr, transcription?, register, synonyms, examples }
 *   }
 * }
 */
export const translationResultSchema = z.object({
  emoji: z.string().min(1, "Emoji is required"),
  register: registerEnum,
  translations: z.object({}).catchall(languageTranslationSchema),
});

/**
 * Build a per-language translation schema, optionally relaxing validation
 * for fields disabled by TranslationOutputConfig.
 *
 * When a field is disabled (e.g. includeExamples: false), the schema
 * accepts empty arrays / missing fields instead of requiring them.
 *
 * @param config - Optional output config to relax disabled fields
 * @returns Zod schema for a single language translation entry
 */
export function buildLanguageTranslationSchema(config?: TranslationOutputConfig) {
  const includeExamples = config?.includeExamples !== false;
  const includeSynonyms = config?.includeSynonyms !== false;

  return z.object({
    text: z.string().min(1, "Translation text is required"),
    cefr: cefrEnum,
    transcription: z.string().optional(),
    register: registerEnum,
    synonyms: includeSynonyms
      ? z.array(synonymSchema)
      : z.array(synonymSchema).default([]),
    examples: includeExamples
      ? z.array(exampleSchema).min(1, "At least one example is required")
      : z.array(exampleSchema).default([]),
    expressionType: expressionTypeEnum.optional().default("literal"),
    equivalentNote: z.string().optional(),
    alternatives: z.array(translationVariantSchema).optional(),
  });
}

/**
 * Build a translation result schema with required language keys.
 *
 * Unlike the generic translationResultSchema (which accepts any keys),
 * this schema explicitly requires specific language keys. This helps
 * AI models (via Vercel AI SDK's structured output) produce all
 * expected translations instead of returning partial/empty objects.
 *
 * @param targetLangs - Language codes that must be present (e.g. ["cs", "en", "es"])
 * @param config - Optional output config to relax disabled fields
 * @returns Zod schema with explicit required language keys
 */
export function buildTranslationResultSchema(targetLangs: string[], config?: TranslationOutputConfig) {
  const langSchema = buildLanguageTranslationSchema(config);
  const langEntries: Record<string, typeof langSchema> = {};
  for (const lang of targetLangs) {
    langEntries[lang] = langSchema;
  }

  return z.object({
    emoji: z.string().min(1, "Emoji is required"),
    register: registerEnum,
    translations: z.object(langEntries),
  });
}

/** Inferred types from schemas for runtime validation */
export type TranslationRequestInput = z.infer<typeof translationRequestSchema>;
export type TranslationResultInput = z.infer<typeof translationResultSchema>;
export type LanguageTranslationInput = z.infer<
  typeof languageTranslationSchema
>;
export type SynonymInput = z.infer<typeof synonymSchema>;
export type TranslationExampleInput = z.infer<typeof exampleSchema>;
export type TranslationVariantInput = z.infer<typeof translationVariantSchema>;
