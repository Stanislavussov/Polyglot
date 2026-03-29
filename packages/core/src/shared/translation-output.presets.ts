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
  includeTranscription: true,
  includeSynonyms: true,
  includeAlternatives: true,
  includeEquivalentNote: true,
  includeCefr: false,
  includeRegister: false,
  includeConnotationWarning: true,
};

/** Lightweight — for bulk topic translation, caching pipelines */
export const MINIMAL_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,
  includeTranscription: true,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeCefr: false,
  includeRegister: false,
  includeConnotationWarning: false,
};

/** Notification word-of-the-day — compact but still useful */
export const NOTIFICATION_OUTPUT: TranslationOutputConfig = {
  includeExamples: true,
  includeTranscription: true,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeCefr: false,
  includeRegister: false,
  includeConnotationWarning: false,
};

/** Sentence translation — just translation text + transcription, no learning metadata */
export const SENTENCE_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,
  includeTranscription: true,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
  includeCefr: false,
  includeRegister: false,
  includeConnotationWarning: false,
};
