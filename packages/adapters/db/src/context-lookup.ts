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
import { logger } from "@polyglot/core";
import { dictionaryLookupLogRepository } from "./repositories/dictionary-lookup-log.repository.js";
import { wordContextRepository } from "./repositories/word-context.repository.js";

function normalizeLookupInput(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * A single all-caps token (TOW, NASA, US) is, in Wiktionary, essentially always
 * an initialism / acronym / abbreviation rather than an ordinary lexical word.
 *
 * Requires at least one cased letter (so "123" or "—" are not treated as
 * acronyms) and no lowercase letters.
 */
function isAllCapsInitialism(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed === trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase();
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

interface LookupAuditEntry {
  lookupInput: string;
  normalizedInput: string;
  langCode: string;
  candidates: DictionaryContextCandidate[];
  error?: string;
}

const AUDIT_WRITE_FAILED = "Failed to record dictionary lookup audit log";

async function recordLookup(input: LookupAuditEntry): Promise<void> {
  const topCandidate = input.candidates[0];
  try {
    await dictionaryLookupLogRepository.record({
      lookupInput: input.lookupInput,
      normalizedInput: input.normalizedInput,
      langCode: input.langCode,
      matched: input.candidates.length > 0,
      matchCount: input.candidates.length,
      matchedWord: topCandidate?.context.word,
      matchType: topCandidate?.matchType,
      matchedPos: topCandidate?.context.pos,
      matchedGlosses: topCandidate?.context.glosses,
      error: input.error,
    });
  } catch (err) {
    // Lookup audit logs are operational telemetry and must never block translation.
    logger.warn({ err }, AUDIT_WRITE_FAILED);
  }
}

/**
 * Start the audit write without waiting for it, so it never gates the candidates
 * returned to the caller.
 *
 * `recordLookup` already swallows its own failures; the `.catch` here is a
 * standing guard so that if it ever stops doing so, a detached write still
 * cannot surface as an unhandled rejection.
 */
function detachRecordLookup(entry: LookupAuditEntry): void {
  recordLookup(entry).catch((err: unknown) => {
    logger.warn({ err }, AUDIT_WRITE_FAILED);
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown dictionary lookup error";
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
    const normalizedWord = normalizeLookupInput(word);
    try {
      const results = await wordContextRepository.findByWordAndLangCode(normalizedWord, langCode);

      // Drop all-caps initialism headwords (e.g. "TOW", the Friends-episode
      // acronym) when the user did not type the input in all-caps — otherwise a
      // lowercase common word like "tow" (буксировать) gets hijacked by the
      // acronym's gloss. A genuine acronym lookup ("TOW") still matches.
      const inputIsInitialism = isAllCapsInitialism(word);
      const candidates = results
        .filter((entry) => inputIsInitialism || !isAllCapsInitialism(entry.word))
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

      detachRecordLookup({ lookupInput: word, normalizedInput: normalizedWord, langCode, candidates });

      return candidates;
    } catch (err) {
      detachRecordLookup({
        lookupInput: word,
        normalizedInput: normalizedWord,
        langCode,
        candidates: [],
        error: errorMessage(err),
      });
      // Fail-open: dictionary context is optional enrichment.
      // DB errors should never break translation.
      return [];
    }
  };
}
