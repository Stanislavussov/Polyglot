/**
 * Strips transient/pipeline metadata from TranslateOutput before DB persistence.
 *
 * Only `emoji`, `register`, and `translations` are stored in the JSONB content.
 * Fields stripped:
 *   - `needsReview`       — transient validation signal
 *   - `dictionaryContext`  — Wiktionary enrichment for AI prompt only
 *   - `original`          — stored as `words.original` column
 *   - `sourceLang`        — stored as `words.sourceLangId` FK
 */
import type { StoredWordContent } from "@polyglot/adapter-db";
import type { TranslateOutput } from "@polyglot/core";

export function sanitizeForStorage(output: TranslateOutput): StoredWordContent {
  return {
    emoji: output.emoji,
    register: output.register,
    translations: output.translations,
  };
}
