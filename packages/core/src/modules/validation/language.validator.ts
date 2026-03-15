import type { ValidationResult } from "./types.js";

/**
 * Validates that the response appears to be in the expected language.
 * Placeholder — real implementation would use a language detection library or AI check.
 */
export function validateLanguage(
  _response: string,
  _expectedLang: string,
): ValidationResult {
  // TODO: integrate language detection
  return {
    valid: true,
    errors: [],
  };
}
