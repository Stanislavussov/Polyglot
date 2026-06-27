/**
 * Dictionary Word Pipeline — named config presets.
 *
 * Callers import a preset; never build config inline.
 * Custom configs are only used in tests.
 */

import type { DictionaryWordConfig } from "./types.js";

/** Default flash card session — 10 random words, all fields visible */
export const FLASHCARD_CONFIG: DictionaryWordConfig = {
  selection: {
    strategy: "random",
    limit: 10,
  },
  presentation: {
    fields: {
      synonyms: true,
      examples: true,
      alternatives: true,
      equivalentNote: true,
      connotationWarning: true,
      grammarBreakdown: false,
    },
    flashcard: { frontSide: "original" },
  },
};

/** Notification daily review — 1 least-reviewed word, compact format */
export const NOTIFICATION_DICT_CONFIG: DictionaryWordConfig = {
  selection: {
    strategy: "least_reviewed",
    limit: 1,
  },
  presentation: {
    fields: {
      synonyms: false,
      examples: false,
      alternatives: false,
      equivalentNote: false,
      connotationWarning: false,
      grammarBreakdown: false,
    },
  },
};

/** Word-of-the-day from dictionary — oldest unreviewed */
export const WORD_OF_DAY_DICT_CONFIG: DictionaryWordConfig = {
  selection: {
    strategy: "oldest_first",
    limit: 1,
  },
  presentation: {
    fields: {
      synonyms: true,
      examples: false,
      alternatives: false,
      equivalentNote: true,
      connotationWarning: true,
      grammarBreakdown: false,
    },
  },
};
