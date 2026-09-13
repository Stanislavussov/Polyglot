import type { SourceUsage, TranslationResult } from "./types.js";

/** Below this length a one-word answer is matched only as a whole word — "go" or "art" sit inside ordinary words. */
const MIN_STEM_LENGTH = 5;
/** Tokens of a multi-word answer shorter than this are articles and particles ("die", "to"), not the answer. */
const MIN_PHRASE_TOKEN_LENGTH = 4;

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? [];
}

/**
 * Whether `hintWords` contain `answerWord` as a word, or — for a long enough
 * answer — an inflected form of it: "работу" gives away "работа" as surely as
 * the citation form does. One trailing letter is the stem; that is crude, but
 * it errs toward dropping a hint, which is the safe side.
 */
function mentionsWord(hintWords: readonly string[], answerWord: string): boolean {
  if (answerWord.length < MIN_STEM_LENGTH) return hintWords.includes(answerWord);
  const stem = answerWord.slice(0, -1);
  return hintWords.some((word) => word.startsWith(stem) && word.length <= answerWord.length + 2);
}

function answersOf(result: TranslationResult): string[] {
  const answers = (result.nativeSynonyms ?? []).map((synonym) => synonym.text);
  for (const block of Object.values(result.translations)) {
    answers.push(block.text, ...(block.synonyms ?? []).map((synonym) => synonym.text));
  }
  return answers;
}

function leaks(hint: string, answer: string): boolean {
  const hintWords = words(hint);
  const answerWords = words(answer);
  if (answerWords.length === 1) return answerWords[0]!.length >= 3 && mentionsWord(hintWords, answerWords[0]!);
  return answerWords
    .filter((word) => word.length >= MIN_PHRASE_TOKEN_LENGTH)
    .some((word) => mentionsWord(hintWords, word));
}

/**
 * Drop a recall hint that names the answer it exists to hide.
 *
 * The prompt forbids it, but a model asked for "a hint" drifts toward the gloss,
 * and a front that prints the translation is worse than a front with no hint. A
 * dropped hint costs nothing — the card renders without it — whereas failing
 * validation would buy another model round for an optional field.
 */
export function withoutLeakingRecallHint(sourceUsage: SourceUsage, result: TranslationResult): SourceUsage {
  if (sourceUsage.recallHint === undefined) return sourceUsage;
  const hint = sourceUsage.recallHint?.trim();
  if (!hint) return { ...sourceUsage, recallHint: null };
  const leaked = answersOf(result).some((answer) => leaks(hint, answer));
  return { ...sourceUsage, recallHint: leaked ? null : hint };
}
