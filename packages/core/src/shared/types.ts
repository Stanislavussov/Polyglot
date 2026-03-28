/**
 * Shared types used by multiple core modules.
 *
 * Types live here when two or more leaf modules need them,
 * preventing forbidden cross-module imports.
 */

/**
 * Controls which fields are included in the AI translation response.
 * All fields default to true (full output) when absent.
 * Set a field to false to omit it from the AI prompt entirely.
 */
export interface TranslationOutputConfig {
  /** Include 3 contextual example sentences (formal/colloquial/professional). Default: true */
  includeExamples?: boolean;
  /** Include IPA transcription (required for non-Latin scripts). Default: true */
  includeTranscription?: boolean;
  /** Include 2–3 synonyms per language. Default: true */
  includeSynonyms?: boolean;
  /** Include up to 2 alternative translation variants. Default: true */
  includeAlternatives?: boolean;
  /** Include expressionType and equivalentNote for idiomatic expressions. Default: true */
  includeEquivalentNote?: boolean;
}
