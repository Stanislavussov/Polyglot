// ~15 items for an 800-word article, +6 per doubling of length; the admin's
// video range [minPhrases, maxPhrases] bounds it like it bounds a video.
const BASE_PHRASES = 15;
const BASE_WORDS = 800;
const PHRASES_PER_DOUBLING = 6;

export function computeArticlePhraseTarget(wordCount: number, minPhrases: number, maxPhrases: number): number {
  const floor = Math.min(minPhrases, maxPhrases);
  const ceil = Math.max(minPhrases, maxPhrases);
  const raw = wordCount > 0 ? BASE_PHRASES + PHRASES_PER_DOUBLING * Math.log2(wordCount / BASE_WORDS) : BASE_PHRASES;
  return Math.min(Math.max(Math.round(raw), floor), ceil);
}
