/**
 * Key for comparing a picked item against what the learner already has.
 *
 * Trim + lowercase, matching how the rest of the codebase compares saved
 * `original` strings. Local to the module: core modules may not import each
 * other, so the video extractor's identical helper is out of reach.
 */
export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}
