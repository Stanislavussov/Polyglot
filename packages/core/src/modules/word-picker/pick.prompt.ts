/**
 * Builds the prompt that turns a curated angle into a word set.
 */

import { normalizeWord } from "./normalize.js";
import type { WordPickRequest } from "./types.js";

/**
 * Cap on the "already seen" list in the prompt. The service post-filters the
 * result anyway, so this only bounds how large the avoid-hint can grow — a
 * learner with a big dictionary must not blow the prompt budget.
 */
const MAX_KNOWN_WORDS_IN_PROMPT = 300;

function buildKnownSection(knownWords: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const word of knownWords) {
    const key = normalizeWord(word);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    unique.push(word.trim());
    if (unique.length >= MAX_KNOWN_WORDS_IN_PROMPT) break;
  }

  if (unique.length === 0) return "";

  return `
## Already seen — do NOT pick these again

${unique.join(", ")}
`;
}

export function buildWordPickPrompt(request: WordPickRequest): string {
  const { angleTitle, anglePrompt, learningLanguage, nativeLanguage, level, count } = request;

  return `You are a linguist who makes ${learningLanguage} surprising for people who already study it. Your reader is a ${level}-level learner whose native language is ${nativeLanguage}.

## The angle: ${angleTitle}

${anglePrompt}

## Task

Pick exactly ${count} items from ${learningLanguage} that genuinely belong to this angle. The angle is the whole point — an item that would fit any generic vocabulary list does not belong here. Do not pad the set with survival-phrasebook material (ordering food, booking a hotel, asking directions) unless the angle explicitly asks for it.

For each item give:
1. The item in ${learningLanguage}, in its dictionary form.
2. A short translation into ${nativeLanguage}. When no real equivalent exists, give the closest gloss rather than inventing a word.
3. One emoji for the meaning.
4. Its type: "word", "phrase", "idiom" or "collocation".
5. Its CEFR level (A1–C2).
6. One natural sentence in ${learningLanguage} that a native speaker could actually say, plus its ${nativeLanguage} translation.
7. A single sentence in ${nativeLanguage} saying what this item reveals — the nuance that gets lost, the trap, the structure the learner's own language does not have. This note is what the learner is here for: make it concrete and specific to the item, never a restatement of the translation.

## Rules

- Prefer items at or slightly above ${level}; a strikingly good item one level off is still worth picking.
- Vary part of speech, register and length across the set.
- No proper nouns, no brand names, no slurs.
- Never repeat an item within the set.
- Write every ${nativeLanguage} field in ${nativeLanguage}, and every ${learningLanguage} field in ${learningLanguage}.
- Sort the set with the most striking item first.
${buildKnownSection(request.knownWords)}`;
}
