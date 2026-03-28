/**
 * Context Enrichment Layer types.
 *
 * Defines the interface for pre-AI dictionary context lookup
 * and enrichment of translation inputs.
 *
 * The layer sits between translation callers and the AI adapter:
 * 1. Receives word + sourceLang
 * 2. Queries dictionary context via injected ContextLookupFn
 * 3. Merges context into the translation input
 * 4. Calls translate() / translateOne()
 *
 * Core never calls the DB directly — lookup is injected.
 */

import type { GenerateObjectFn } from "../translation/translation.service.js";
import type { DictionaryContext, TranslateInput } from "../translation/types.js";

/**
 * Lookup function that retrieves dictionary context for a word.
 * Injected from the DB adapter layer — core stays platform-independent.
 *
 * @param word - The word to look up
 * @param langCode - ISO 639-1 language code (e.g., "ru", "en")
 * @returns DictionaryContext if found, undefined otherwise
 */
export type ContextLookupFn = (word: string, langCode: string) => Promise<DictionaryContext | undefined>;

/**
 * Dependencies injected into the context enrichment service.
 * Follows the same DI pattern as GenerateObjectFn in the translation service.
 */
export interface ContextEnrichmentDeps {
  /** Function to look up dictionary context for a word */
  lookupContext: ContextLookupFn;
  /** AI generation function — passed through to translate() */
  generateObjectFn: GenerateObjectFn;
}

/**
 * Input for context-enriched translation.
 *
 * Same as TranslateInput but omits `dictionaryContext` — the enrichment
 * layer fills it automatically from the lookup function.
 * Callers don't set it; prevents accidental double-lookup.
 */
export type EnrichedTranslateInput = Omit<TranslateInput, "dictionaryContext">;
