/**
 * Context Lookup Factory — creates a ContextLookupFn for the enrichment layer.
 *
 * This is the **single place** where DB word_context rows are transformed
 * into DictionaryContext objects. All consumers use this factory instead
 * of calling wordContextRepository directly.
 *
 * Fail-open: catches errors, returns undefined.
 */
import type { ContextLookupFn } from "@polyglot/core";
import { wordContextRepository } from "./repositories/word-context.repository.js";

/**
 * Create a ContextLookupFn that wraps wordContextRepository.findByWordAndLangCode().
 *
 * The returned function:
 * 1. Queries word_context table by word + language code
 * 2. Transforms the first result into DictionaryContext
 * 3. Returns undefined if no results or on error (fail-open)
 *
 * @returns ContextLookupFn — ready to inject into ContextEnrichmentDeps
 */
export function createContextLookup(): ContextLookupFn {
  return async (word, langCode) => {
    try {
      const results = await wordContextRepository.findByWordAndLangCode(word, langCode);

      if (results.length === 0) return undefined;

      const entry = results[0]!;
      return {
        word: entry.word,
        pos: entry.pos,
        glosses: entry.glosses ?? [],
        formTags: entry.formTags ?? [],
        langCode,
      };
    } catch {
      // Fail-open: dictionary context is optional enrichment.
      // DB errors should never break translation.
      return undefined;
    }
  };
}
