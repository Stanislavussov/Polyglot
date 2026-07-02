/**
 * Normalizes a phrase for duplicate detection when deduplicating extraction
 * output against phrases the learner already knows.
 *
 * Comparison is exact after trimming surrounding whitespace and lowercasing —
 * intentionally simple (no lemmatization), matching how saved-vocabulary
 * duplicate detection compares `original` strings elsewhere.
 */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase();
}
