/**
 * Translation Output Presets — centralized, single source of truth.
 *
 * Every caller imports a named preset instead of constructing
 * TranslationOutputConfig inline. When you need to change what
 * a use case includes, change it here — in one place.
 *
 * Rule: callers must always use a named preset — never construct
 * TranslationOutputConfig inline.
 *
 * Lives in shared/ because multiple leaf modules (topics, translation)
 * need these presets without creating forbidden cross-module imports.
 */
import type { TranslationOutputConfig } from "./types.js";

/** All sections enabled — default for interactive translation & regeneration */
export const FULL_OUTPUT: TranslationOutputConfig = {
  includeExamples: true,
  includeSynonyms: true,
  includeAlternatives: true,
  includeEquivalentNote: true,
  includeUsageNote: true,
  includeConnotationWarning: true,
  includeNativeSynonyms: true,
  includeGrammarBreakdown: true,
};

/** Reliable default — one translation per language, minimal metadata for small models */
export const RELIABLE_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeUsageNote: true,
  includeConnotationWarning: false,
  includeNativeSynonyms: false,
  includeGrammarBreakdown: false,
};

/** Lightweight — for bulk topic translation, caching pipelines */
export const MINIMAL_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeUsageNote: false,
  includeConnotationWarning: false,
  includeNativeSynonyms: false,
  includeGrammarBreakdown: false,
};

/** Notification word-of-the-day — compact but still useful */
export const NOTIFICATION_OUTPUT: TranslationOutputConfig = {
  includeExamples: true,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeUsageNote: true,
  includeConnotationWarning: false,
  includeNativeSynonyms: false,
  includeGrammarBreakdown: false,
};

/** Sentence translation — just translation text, no learning metadata, no emoji/nativeMeaning */
export const SENTENCE_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeUsageNote: false,
  includeConnotationWarning: false,
  includeNativeSynonyms: false,
  includeGrammarBreakdown: false,
  includeEmoji: false,
  includeNativeMeaning: false,
};
