/**
 * Context Enrichment Service — pre-AI dictionary context lookup.
 *
 * Sits between translation callers and the AI adapter. Before every
 * AI translation request, this layer:
 * 1. Queries dictionary context via injected ContextLookupFn
 * 2. Merges retrieved context into the translation input
 * 3. Passes the enriched input to translate() / translateOne()
 *
 * All functions are pure (no side effects beyond injected deps) —
 * fully testable with mocks.
 *
 * Fail-open: lookup errors are caught and swallowed — the translation
 * proceeds without dictionary context.
 */

import { translate, translateOne } from "../translation/translation.service.js";
import type { LanguageTranslation, TranslateOutput } from "../translation/types.js";
import type { ContextEnrichmentDeps, EnrichedTranslateInput } from "./types.js";

/**
 * Translate a word with automatic dictionary context enrichment.
 *
 * Flow:
 * 1. Look up dictionary context for the word (fail-open)
 * 2. Merge context into TranslateInput
 * 3. Call translate() from the translation module
 * 4. Return TranslateOutput as-is
 *
 * @param input - Word, source/target languages, model (no dictionaryContext)
 * @param deps - Injected dependencies (lookupContext + generateObjectFn)
 * @returns TranslateOutput with translations for all requested languages
 */
export async function translateWithContext(
  input: EnrichedTranslateInput,
  deps: ContextEnrichmentDeps,
): Promise<TranslateOutput> {
  const dictionaryContext = await safeLookup(deps.lookupContext, input.word, input.sourceLang);

  return translate({ ...input, dictionaryContext }, deps.generateObjectFn);
}

/**
 * Re-translate a word for a single target language with context enrichment.
 *
 * Same pattern as translateWithContext but delegates to translateOne().
 *
 * @param input - Same as EnrichedTranslateInput, plus targetLang
 * @param deps - Injected dependencies
 * @returns LanguageTranslation for the requested language
 */
export async function translateOneWithContext(
  input: EnrichedTranslateInput & { targetLang: string },
  deps: ContextEnrichmentDeps,
): Promise<LanguageTranslation> {
  const dictionaryContext = await safeLookup(deps.lookupContext, input.word, input.sourceLang);

  return translateOne({ ...input, dictionaryContext }, deps.generateObjectFn);
}

/**
 * Translate a batch of words with per-word context enrichment.
 *
 * For each word:
 * 1. Look up dictionary context (fail-open)
 * 2. Call translate() with enriched input
 *
 * Sequential processing (same as existing translateBatch) to avoid
 * AI rate limits.
 *
 * @param words - Array of words to translate
 * @param sourceLang - Source language code
 * @param targetLangs - Target language codes
 * @param model - AI model ID
 * @param deps - Injected dependencies
 * @returns Array of TranslateOutput, one per word
 */
export async function translateBatchWithContext(
  words: string[],
  sourceLang: string,
  targetLangs: string[],
  model: string,
  deps: ContextEnrichmentDeps,
): Promise<TranslateOutput[]> {
  const results: TranslateOutput[] = [];

  for (const word of words) {
    const output = await translateWithContext({ word, sourceLang, targetLangs, model }, deps);
    results.push(output);
  }

  return results;
}

/**
 * Safe lookup wrapper — catches errors and returns undefined.
 * Fail-open: dictionary context is optional enrichment.
 */
async function safeLookup(
  lookupContext: ContextEnrichmentDeps["lookupContext"],
  word: string,
  langCode: string,
): Promise<import("../translation/types.js").DictionaryContext | undefined> {
  try {
    return await lookupContext(word, langCode);
  } catch {
    // Fail-open: dictionary context lookup is optional enrichment.
    // On error, translation proceeds without context.
    return undefined;
  }
}
