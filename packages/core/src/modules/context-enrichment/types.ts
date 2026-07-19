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

import type { GenerateObjectFn } from "../../ports/ai.port.js";
import type { DictionaryContext, TranslateInput, TranslationPhaseObserver } from "../translation/types.js";

export type DictionaryContextMatchType = "exact_expression" | "known_form" | "lemma";

export interface DictionaryContextCandidate {
  matchType: DictionaryContextMatchType;
  context: DictionaryContext;
}

/**
 * Lookup function that retrieves dictionary context for a word.
 * Injected from the DB adapter layer — core stays platform-independent.
 *
 * @param word - The word to look up
 * @param langCode - ISO 639-1 language code (e.g., "ru", "en")
 * @returns Deterministically ordered dictionary candidates, or an empty array
 */
export type ContextLookupFn = (word: string, langCode: string) => Promise<DictionaryContextCandidate[]>;

/**
 * Dependencies injected into the context enrichment service.
 * Follows the same DI pattern as GenerateObjectFn from the AI port.
 */
export interface ContextEnrichmentDeps {
  /** Function to look up dictionary context for a word */
  lookupContext: ContextLookupFn;
  /** AI generation function — passed through to translate() */
  generateObjectFn: GenerateObjectFn;
  /**
   * Optional sink for core's internal phase timings (`generate`, `validate`,
   * `judge`). `validate` and `judge` happen entirely inside the pipeline, so
   * without this seam a caller cannot measure them at all.
   *
   * Core stays pure: it emits numbers into whatever sink it is handed and knows
   * nothing about metrics. Absent → no-op; a throwing observer is logged and
   * ignored, never affecting the translation.
   */
  onPhase?: TranslationPhaseObserver;
}

/**
 * Input for context-enriched translation.
 *
 * Same as TranslateInput but omits `dictionaryContext` — the enrichment layer
 * fills it automatically from the lookup function. Prevents accidental
 * double-lookup.
 */
export type EnrichedTranslateInput = Omit<TranslateInput, "dictionaryContext">;
