import type { ValidationResult } from "../types.js";
import { resolveToIso3 } from "../../i18n/language-codes.js";

export { resolveToIso3 };

/**
 * Language validation — currently a no-op (always passes).
 *
 * Previously used franc-min for trigram-based detection, but it proved
 * unreliable for translation-length texts (15–40 chars), producing
 * frequent false positives (Czech↔German, Czech↔Spanish, etc.).
 *
 * Language correctness is ensured by:
 * - AI prompt specifying target languages
 * - Zod schema enforcing required language keys
 * - Semantic validation catching hallucinations
 *
 * This function is retained for API compatibility. It can be replaced
 * with a more accurate detection library in the future if needed.
 */
export function validateLanguage(
  _text: string,
  _expectedLang: string,
): ValidationResult {
  return { valid: true, errors: [] };
}
