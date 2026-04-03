/**
 * Lite AI Validation — High-Risk Detection Heuristic
 *
 * Determines whether a translation should be sent to the lite AI validator
 * based on risk criteria. Only high-risk translations are validated to
 * keep costs low and avoid unnecessary latency.
 *
 * Pure function — no side effects, no I/O.
 */

import type { RiskDetectorInput } from "./types.js";

/**
 * Default list of "safe" languages — well-represented in AI training data.
 * Translations into these languages are less likely to contain errors.
 *
 * Can be overridden by passing a custom allowlist.
 */
export const SAFE_LANGUAGES: readonly string[] = ["en", "es", "fr", "de", "ru", "zh", "ja", "ko", "pt", "it"];

/**
 * Determine whether a translation is high-risk and should be validated
 * by the lite AI model.
 *
 * Returns `true` when ANY of these criteria is met:
 * 1. Input type is "phrase" or dictionary context POS is "idiom" or "phrase"
 * 2. Any expression type in the result is "idiomatic_equivalent"
 * 3. Dictionary context is undefined (Wiktionary miss — no reference data)
 * 4. Any target language is not in the safe languages allowlist
 *
 * @param input - Risk detection input
 * @param safeLangs - Override safe languages list (for testing or customization)
 */
export function isHighRisk(input: RiskDetectorInput, safeLangs: readonly string[] = SAFE_LANGUAGES): boolean {
  // Criterion 1: Phrase/idiom input
  if (input.inputType === "phrase") {
    return true;
  }
  if (input.dictionaryContext?.pos === "idiom" || input.dictionaryContext?.pos === "phrase") {
    return true;
  }

  // Criterion 2: Idiomatic equivalent expression type
  if (input.expressionTypes?.some((et) => et === "idiomatic_equivalent")) {
    return true;
  }

  // Criterion 3: Wiktionary miss — no dictionary context available
  if (input.dictionaryContext === undefined) {
    return true;
  }

  // Criterion 4: Uncommon target language
  if (input.targetLangs.some((lang) => !safeLangs.includes(lang))) {
    return true;
  }

  return false;
}
