/**
 * Zod schemas for translation request and AI response.
 *
 * translationResultSchema is the single source of truth —
 * prompt output and TypeScript types are derived from it.
 */
import { z } from "zod";
import type { TranslationOutputConfig } from "../types.js";

/** Valid expression type values */
const expressionTypeEnum = z.enum(["literal", "idiomatic_equivalent"]);

/** Zod schema for a synonym */
export const synonymSchema = z.object({
  text: z.string().min(1, "Synonym text is required"),
});

/** Zod schema for an example sentence */
export const exampleSchema = z.object({
  context: z.string().min(1, "Example context is required"),
  target: z.string().min(1, "Example target sentence is required"),
  native: z.string().min(1, "Example native sentence is required").nullish(),
});

/** Zod schema for source-language usage help in reverse-learning translations */
export const sourceUsageSchema = z.object({
  explanation: z.string().min(1, "Source usage explanation is required"),
  synonyms: z.array(synonymSchema),
  examples: z.array(exampleSchema),
});

function buildExampleSchema(requireNative: boolean) {
  return z.object({
    context: z.string().min(1, "Example context is required"),
    target: z.string().min(1, "Example target sentence is required"),
    native: requireNative
      ? z.string().min(1, "Example native sentence is required")
      : z.string().min(1, "Example native sentence is required").nullish(),
  });
}

/** Zod schema for a translation variant (alternative translation) */
export const translationVariantSchema = z.object({
  text: z.string().min(1, "Variant text is required"),
  synonyms: z.array(synonymSchema),
});

/**
 * Zod schema for a single language translation.
 *
 * Uses .nullish() (nullable + optional) so it accepts both null (from AI strict
 * mode) and undefined (from manually constructed objects in tests/validation).
 * For the AI-facing schema sent via generateObject, see buildLanguageTranslationSchema
 * which uses .nullable() only (all fields required, satisfying strict mode).
 */
export const languageTranslationSchema = z.object({
  text: z.string().min(1, "Translation text is required"),
  synonyms: z.array(synonymSchema),
  examples: z.array(exampleSchema).min(1, "At least one example is required"),
  expressionType: expressionTypeEnum.nullish().default("literal"),
  equivalentNote: z.string().nullish(),
  alternatives: z.array(translationVariantSchema).nullish(),
  connotationWarning: z.string().nullish(),
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
 *   nativeSynonyms: [{ text: "хитрый" }, ...],
 *   translations: {
 *     "cs": { text, synonyms, examples },
 *   }
 * }
 */
export const translationResultSchema = z.object({
  emoji: z.string().min(1, "Emoji is required"),
  nativeMeaning: z.string().min(1, "Native meaning is required").nullish(),
  sourceUsage: sourceUsageSchema.nullish(),
  nativeSynonyms: z.array(synonymSchema),
  translations: z.object({}).catchall(languageTranslationSchema),
});

function buildSourceUsageSchema(config?: TranslationOutputConfig, requireExampleNative = false) {
  const includeExamples = config?.includeExamples !== false;
  const includeSynonyms = config?.includeSynonyms !== false;

  return z.object({
    explanation: z.string().min(1, "Source usage explanation is required"),
    synonyms: includeSynonyms ? z.array(synonymSchema) : z.array(synonymSchema).optional(),
    examples: includeExamples
      ? z.array(buildExampleSchema(requireExampleNative)).min(1)
      : z.array(exampleSchema).optional(),
  });
}

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
export function buildLanguageTranslationSchema(config?: TranslationOutputConfig, requireExampleNative = false) {
  const includeExamples = config?.includeExamples !== false;
  const includeSynonyms = config?.includeSynonyms !== false;
  const includeAlternatives = config?.includeAlternatives !== false;
  const includeEquivalentNote = config?.includeEquivalentNote !== false;
  const includeConnotationWarning = config?.includeConnotationWarning !== false;

  const shape = {
    text: z.string().min(1, "Translation text is required"),
    ...(includeSynonyms && { synonyms: z.array(synonymSchema) }),
    ...(includeExamples && {
      examples: z.array(buildExampleSchema(requireExampleNative)).min(1, "At least one example is required"),
    }),
    ...(includeEquivalentNote && {
      expressionType: expressionTypeEnum.nullable(),
      equivalentNote: z.string().nullable(),
    }),
    ...(includeAlternatives && { alternatives: z.array(translationVariantSchema).nullable() }),
    ...(includeConnotationWarning && { connotationWarning: z.string().nullable() }),
  };

  return z.object(shape);
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
export function buildTranslationResultSchema(
  targetLangs: string[],
  config?: TranslationOutputConfig,
  requireNative = false,
  requireSourceUsage = false,
) {
  const langSchema = buildLanguageTranslationSchema(config, requireNative);
  const langEntries: Record<string, typeof langSchema> = {};
  for (const lang of targetLangs) {
    langEntries[lang] = langSchema;
  }

  const includeNativeSynonyms = config?.includeNativeSynonyms !== false;
  return z.object({
    emoji: z.string().min(1, "Emoji is required"),
    ...(requireNative && { nativeMeaning: z.string().min(1, "Native meaning is required") }),
    ...(requireSourceUsage && { sourceUsage: buildSourceUsageSchema(config, requireNative) }),
    ...(includeNativeSynonyms && { nativeSynonyms: z.array(synonymSchema) }),
    translations: z.object(langEntries),
  });
}

/** Inferred types from schemas for runtime validation */
export type TranslationRequestInput = z.infer<typeof translationRequestSchema>;
export type TranslationResultInput = z.infer<typeof translationResultSchema>;
export type LanguageTranslationInput = z.infer<typeof languageTranslationSchema>;
export type SynonymInput = z.infer<typeof synonymSchema>;
export type TranslationExampleInput = z.infer<typeof exampleSchema>;
export type TranslationVariantInput = z.infer<typeof translationVariantSchema>;
export type SourceUsageInput = z.infer<typeof sourceUsageSchema>;
