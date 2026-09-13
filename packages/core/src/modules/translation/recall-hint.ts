import type { SourceUsage, TranslationResult } from "./types.js";

/** Below this length a "leak" match is noise — a one- or two-letter translation sits inside ordinary words. */
const MIN_LEAK_LENGTH = 3;

function answersOf(result: TranslationResult): string[] {
  const answers = [...(result.nativeSynonyms ?? []).map((synonym) => synonym.text)];
  for (const block of Object.values(result.translations)) {
    answers.push(block.text, ...(block.synonyms ?? []).map((synonym) => synonym.text));
  }
  return answers.map((answer) => answer.trim().toLowerCase()).filter((answer) => answer.length >= MIN_LEAK_LENGTH);
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
  const lowered = hint.toLowerCase();
  const leaks = answersOf(result).some((answer) => lowered.includes(answer));
  return { ...sourceUsage, recallHint: leaks ? null : hint };
}
