import type { ValidationResult } from "../types.js";

/** Patterns that indicate AI hallucination or refusal */
const HALLUCINATION_PATTERNS = [
  "N/A",
  "n/a",
  "I cannot",
  "I can't",
  "I'm unable",
  "I am unable",
  "—",
  "...",
  "undefined",
  "null",
  "[translation]",
  "<translation>",
];

/**
 * Validates semantic correctness of a translation.
 *
 * Rules:
 * - Translation must not equal the original (case-insensitive)
 * - Translation must not be empty
 * - Translation must not contain hallucination patterns
 *
 * Pure function — no side effects.
 */
export function validateSemantic(
  original: string,
  translation: string,
): ValidationResult {
  const errors: ValidationResult["errors"] = [];

  // Check empty translation
  if (!translation || translation.trim().length === 0) {
    errors.push({
      rule: "semantic",
      message: "Translation is empty",
      field: "text",
    });
    return { valid: false, errors };
  }

  const trimmedOriginal = original.trim().toLowerCase();
  const trimmedTranslation = translation.trim().toLowerCase();

  // Check translation equals original
  if (trimmedOriginal === trimmedTranslation) {
    errors.push({
      rule: "semantic",
      message: `Translation "${translation}" is identical to original "${original}"`,
      field: "text",
    });
  }

  // Check hallucination patterns
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (trimmedTranslation === pattern.toLowerCase()) {
      errors.push({
        rule: "semantic",
        message: `Translation contains hallucination pattern: "${pattern}"`,
        field: "text",
      });
      break;
    }
  }

  // Check for hallucination as substring (for longer texts)
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (
      pattern.length > 3 &&
      trimmedTranslation.includes(pattern.toLowerCase())
    ) {
      errors.push({
        rule: "semantic",
        message: `Translation contains hallucination pattern: "${pattern}"`,
        field: "text",
      });
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}
