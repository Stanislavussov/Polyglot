/**
 * Computes how many phrases to extract from a video based on its duration.
 *
 * The target scales with the logarithm of the duration so that longer videos
 * yield more vocabulary without growing unbounded. Anchored to the product
 * spec: ~20 phrases at 30 min, +10 per doubling of length (≈30 at 1 h, ≈40 at
 * 2 h), then clamped to the admin-configured [minPhrases, maxPhrases] range.
 */

const BASE_PHRASES = 20;
const BASE_MINUTES = 30;
const PHRASES_PER_DOUBLING = 10;

export function computePhraseTarget(durationSeconds: number, minPhrases: number, maxPhrases: number): number {
  const floor = Math.min(minPhrases, maxPhrases);
  const ceil = Math.max(minPhrases, maxPhrases);

  const minutes = durationSeconds / 60;
  // Unknown/invalid duration → fall back to the baseline target.
  const raw = minutes > 0 ? BASE_PHRASES + PHRASES_PER_DOUBLING * Math.log2(minutes / BASE_MINUTES) : BASE_PHRASES;

  return Math.min(Math.max(Math.round(raw), floor), ceil);
}
