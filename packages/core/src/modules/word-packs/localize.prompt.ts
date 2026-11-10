/**
 * Builds the prompt that localizes one batch of an author's words into every
 * language a pack is offered in.
 */
import type { PackLanguage, PackSourceWord } from "./types.js";

export function buildPackLocalizationPrompt(
  words: readonly PackSourceWord[],
  languages: readonly PackLanguage[],
  langName: (code: string) => string,
): string {
  const list = words.map((word, index) => `${index + 1}. ${word.headword} (${langName(word.lang)})`).join("\n");
  const targets = languages.map((language) => `${language.code} — ${language.name}`).join("\n");

  return `You are a lexicographer building a set of striking words for language learners. Each learner will receive one word in the language they study, explained in their own language.

## Words

${list}

## Target languages

${targets}

## Task

For each word give:
1. Its CEFR level (A1–C2), judged as a word a learner meets — a rare, literary or culturally loaded word is C1 or C2.
2. One emoji for its meaning.
3. For every target language, the word or short phrase a native speaker would naturally use for the same idea, at the same register. Use an idiom when the language has one; never a word-for-word gloss. When a language genuinely has no such word, give an empty string for it rather than a description.

## Rules

- Answer every word, using its number from the list as "index".
- Use the target languages' ISO 639-1 codes exactly as listed.
- Dictionary form; no articles unless the language always writes one with the noun.
- No explanations — words only.`;
}
