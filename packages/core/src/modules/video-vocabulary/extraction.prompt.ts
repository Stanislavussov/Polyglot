/**
 * Builds the system prompt for phrase extraction from video transcripts.
 */

import { normalizePhrase } from "./normalize.js";

/**
 * Maximum number of already-known phrases to list in the prompt. The hard
 * post-filter in the extraction service covers the rest — this cap only bounds
 * how big the "avoid" hint can grow so a large vocabulary doesn't blow the
 * prompt budget.
 */
const MAX_KNOWN_PHRASES_IN_PROMPT = 500;

/** Build the "already known — do not extract" section, or "" when there is nothing to exclude. */
function buildKnownPhrasesSection(knownPhrases: string[]): string {
  if (knownPhrases.length === 0) return "";

  // Deduplicate case-insensitively while preserving the first-seen original form.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const phrase of knownPhrases) {
    const key = normalizePhrase(phrase);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push(phrase.trim());
    if (unique.length >= MAX_KNOWN_PHRASES_IN_PROMPT) break;
  }

  if (unique.length === 0) return "";

  return `
## Already Known — DO NOT extract these

The learner already has the following ${unique.length} items (from their saved dictionary and previously processed videos). Do NOT include any of them, nor a trivial variant (different casing, inflection, or article) of one. Spend the budget on genuinely new items instead:

${unique.join(", ")}
`;
}

export function buildExtractionPrompt(
  transcript: string,
  videoLanguage: string,
  userLevel: string,
  targetPhrases: number,
  nativeLanguage: string,
  knownPhrases: string[] = [],
): string {
  const knownSection = buildKnownPhrasesSection(knownPhrases);

  return `You are a language learning expert. Analyze the following video transcript in ${videoLanguage} and extract a rich set of valuable phrases for a ${userLevel}-level learner whose native language is ${nativeLanguage}.

## Instructions

1. Extract ${targetPhrases} phrases from the transcript. Aim for the full target of ${targetPhrases} — only return fewer if the transcript is genuinely too short or repetitive to yield that many useful items.
2. To reach the target, draw a varied mix from across the whole transcript (beginning, middle, and end):
   - Idiomatic expressions and idioms
   - Phrasal verbs
   - Useful collocations (word combinations that native speakers use naturally)
   - Individual words that are new, advanced, or nuanced for a ${userLevel} learner
3. Tailor the selection to CEFR level ${userLevel}: prefer items at or slightly above ${userLevel}. Skip words far below the learner's level (already trivially known) and avoid extremely rare jargon far above it.
4. For each phrase, provide:
   - The exact phrase as used in the transcript (or its base/dictionary form if conjugated)
   - A concise translation of the phrase into ${nativeLanguage} (the user's native language)
   - The type: "word", "phrase", "idiom", or "collocation"
   - The CEFR level of the phrase (A1-C2)
   - The original sentence from the transcript where the phrase appears (as context)
   - The timestamp in seconds where this phrase appears. The transcript includes [Ns] markers (e.g. [120s] means 120 seconds). Copy the number from the nearest preceding marker as the timestampSeconds value
5. Sort results by learning value — most useful and level-appropriate phrases first.
6. Do not include the same phrase twice. Skip proper nouns, brand names, and filler or incomplete fragments.
7. Prefer phrases with context — a collocation like "break it down" is more valuable than the isolated word "break".
${knownSection}
## Transcript

${transcript}`;
}
