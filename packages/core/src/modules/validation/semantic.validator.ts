import type { ValidationResult } from "./types.js";

/**
 * Validates that an AI response is semantically meaningful
 * (not empty, not gibberish, etc.)
 */
export function validateSemanticContent(response: string): ValidationResult {
  const errors = [];

  if (!response || response.trim().length === 0) {
    errors.push({
      code: "EMPTY_RESPONSE",
      message: "AI response is empty",
    });
  }

  if (response.trim().length < 2) {
    errors.push({
      code: "TOO_SHORT",
      message: "AI response is too short to be meaningful",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
