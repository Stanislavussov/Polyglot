/**
 * Builds the system prompt for phrase extraction from video transcripts.
 */

export function buildExtractionPrompt(
  transcript: string,
  videoLanguage: string,
  userLevel: string,
  targetPhrases: number,
  nativeLanguage: string,
): string {
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

## Transcript

${transcript}`;
}
