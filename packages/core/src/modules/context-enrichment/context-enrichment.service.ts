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
import type { DictionaryContext, TranslationDecision } from "../translation/types.js";
import type { ContextEnrichmentDeps, EnrichedTranslateInput } from "./types.js";

export async function translateWithContext(
  input: EnrichedTranslateInput,
  deps: ContextEnrichmentDeps,
): Promise<TranslationDecision> {
  const lookup = await lookupUnambiguousContext(deps.lookupContext, input.word, input.sourceLang);

  return translate(
    {
      ...input,
      dictionaryContext: lookup.context,
      correctionPolicy: { ...input.correctionPolicy, dictionaryHit: lookup.hit },
    },
    deps.generateObjectFn,
  );
}

export async function translateOneWithContext(
  input: EnrichedTranslateInput & { targetLang: string },
  deps: ContextEnrichmentDeps,
): Promise<TranslationDecision> {
  const lookup = await lookupUnambiguousContext(deps.lookupContext, input.word, input.sourceLang);

  return translateOne(
    {
      ...input,
      dictionaryContext: lookup.context,
      correctionPolicy: { ...input.correctionPolicy, dictionaryHit: lookup.hit },
    },
    deps.generateObjectFn,
  );
}

export async function translateBatchWithContext(
  words: string[],
  sourceLang: string,
  targetLangs: string[],
  model: string,
  deps: ContextEnrichmentDeps,
): Promise<TranslationDecision[]> {
  const results: TranslationDecision[] = [];

  for (const word of words) {
    const decision = await translateWithContext({ word, sourceLang, targetLangs, model }, deps);
    results.push(decision);
  }

  return results;
}

/**
 * Safe lookup wrapper — catches errors and fails open.
 *
 * `context` is set only for an unambiguous single match. `hit` reports whether
 * the word exists in the dictionary at all (any number of candidates) — a
 * `false` hit is a typo/missing-diacritics signal consumed by the AI preflight.
 * On lookup error `hit` is undefined so the miss signal is never fabricated.
 */
async function lookupUnambiguousContext(
  lookupContext: ContextEnrichmentDeps["lookupContext"],
  word: string,
  langCode: string,
): Promise<{ context: DictionaryContext | undefined; hit: boolean | undefined }> {
  try {
    const candidates = await lookupContext(word, langCode);
    return {
      context: candidates.length === 1 ? candidates[0]?.context : undefined,
      hit: candidates.length > 0,
    };
  } catch {
    // Fail-open: dictionary context lookup is optional enrichment.
    // On error, translation proceeds without context.
    return { context: undefined, hit: undefined };
  }
}
