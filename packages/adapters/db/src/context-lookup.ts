/**
 * Context Lookup Factory — creates a ContextLookupFn for the enrichment layer.
 *
 * This is the **single place** where DB word_context rows are transformed
 * into DictionaryContextCandidate objects. All consumers use this factory instead
 * of calling wordContextRepository directly.
 *
 * Fail-open: catches errors, returns an empty candidate array.
 */
import type { ContextLookupFn, DictionaryContextCandidate, DictionaryContextMatchType } from "@polyglot/core";
import { wordContextRepository } from "./repositories/word-context.repository.js";

function normalizeLookupInput(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function getMatchType(
  normalizedInput: string,
  entry: { word: string; forms?: string[] | null },
): DictionaryContextMatchType {
  const normalizedHeadword = normalizeLookupInput(entry.word);
  if (normalizedHeadword === normalizedInput) {
    return normalizedInput.includes(" ") ? "exact_expression" : "lemma";
  }

  const matchesKnownForm = (entry.forms ?? []).some((form) => normalizeLookupInput(form) === normalizedInput);
  return matchesKnownForm ? "known_form" : "lemma";
}

function compareCandidates(left: DictionaryContextCandidate, right: DictionaryContextCandidate): number {
  const matchOrder: Record<DictionaryContextMatchType, number> = {
    exact_expression: 0,
    known_form: 1,
    lemma: 2,
  };

  return (
    matchOrder[left.matchType] - matchOrder[right.matchType] ||
    left.context.word.localeCompare(right.context.word) ||
    left.context.pos.localeCompare(right.context.pos) ||
    left.context.glosses.join("\u0000").localeCompare(right.context.glosses.join("\u0000")) ||
    (left.context.formTags ?? []).join("\u0000").localeCompare((right.context.formTags ?? []).join("\u0000"))
  );
}

/**
 * Create a ContextLookupFn that wraps wordContextRepository.findByWordAndLangCode().
 *
 * The returned function:
 * 1. Normalizes the lookup input
 * 2. Queries word_context by headword/expression or known form + language code
 * 3. Transforms every result into a deterministic DictionaryContextCandidate
 * 4. Returns an empty array if no results or on error (fail-open)
 *
 * @returns ContextLookupFn — ready to inject into ContextEnrichmentDeps
 */
export function createContextLookup(): ContextLookupFn {
  return async (word, langCode) => {
    try {
      const normalizedWord = normalizeLookupInput(word);
      const results = await wordContextRepository.findByWordAndLangCode(normalizedWord, langCode);

      return results
        .map(
          (entry): DictionaryContextCandidate => ({
            matchType: getMatchType(normalizedWord, entry),
            context: {
              word: entry.word,
              pos: entry.pos,
              glosses: entry.glosses ?? [],
              formTags: entry.formTags ?? [],
              langCode,
            },
          }),
        )
        .sort(compareCandidates);
    } catch {
      // Fail-open: dictionary context is optional enrichment.
      // DB errors should never break translation.
      return [];
    }
  };
}
