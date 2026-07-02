/**
 * Word Language Sweep Factory — creates a FindWordLanguagesFn for detection.
 *
 * One indexed query answers "which supported languages know this word?",
 * giving single-word detection both candidate evidence and out-of-set
 * signals (e.g. Czech "strohá" for a user who only learns English).
 *
 * Fail-open: catches errors, returns an empty array — the sweep is advisory
 * and must never block translation.
 */
import type { FindWordLanguagesFn } from "@polyglot/core";
import { wordContextRepository } from "./repositories/word-context.repository.js";

function normalizeSweepInput(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Create a FindWordLanguagesFn that wraps wordContextRepository.findLanguageCodesByWord().
 *
 * The returned function:
 * 1. Normalizes the input (NFC, trim, lowercase)
 * 2. Short-circuits empty or multi-word input (single words only)
 * 3. Returns supported-language codes ordered by dictionary coverage
 * 4. Returns an empty array on error (fail-open)
 */
export function createWordLanguageSweep(): FindWordLanguagesFn {
  return async (word) => {
    const normalized = normalizeSweepInput(word);
    if (normalized.length === 0 || normalized.includes(" ")) return [];

    try {
      const rows = await wordContextRepository.findLanguageCodesByWord(normalized);
      return rows.map((row) => row.code);
    } catch {
      return [];
    }
  };
}
