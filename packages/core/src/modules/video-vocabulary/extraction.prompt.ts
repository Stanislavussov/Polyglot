/**
 * Builds the system prompt for phrase extraction from video transcripts.
 */

export function buildExtractionPrompt(
  transcript: string,
  videoLanguage: string,
  userLevel: string,
  maxPhrases: number,
  nativeLanguage: string,
): string {
  return `You are a language learning expert. Analyze the following video transcript in ${videoLanguage} and extract the most valuable phrases for a ${userLevel}-level learner whose native language is ${nativeLanguage}.

## Instructions

1. Extract up to ${maxPhrases} phrases from the transcript that would be most useful for a learner at CEFR level ${userLevel}.
2. Focus on:
   - Idiomatic expressions and idioms
   - Phrasal verbs
   - Useful collocations (word combinations that native speakers use naturally)
   - Individual words that are advanced or nuanced for the learner's level
3. For each phrase, provide:
   - The exact phrase as used in the transcript (or its base/dictionary form if conjugated)
   - A concise translation of the phrase into ${nativeLanguage} (the user's native language)
   - The type: "word", "phrase", "idiom", or "collocation"
   - The CEFR level of the phrase (A1-C2)
   - The original sentence from the transcript where the phrase appears (as context)
   - The approximate timestamp in seconds where this phrase appears
4. Sort results by learning value — most useful and level-appropriate phrases first.
5. Skip:
   - Common words that a ${userLevel} learner would already know
   - Proper nouns, brand names, or highly specialized jargon
   - Filler words or incomplete phrases
6. Prefer phrases with context — a collocation like "break it down" is more valuable than the isolated word "break".
7. If the transcript has fewer than ${maxPhrases} valuable phrases for this level, return only what is genuinely useful. Quality over quantity.

## Transcript

${transcript}`;
}
