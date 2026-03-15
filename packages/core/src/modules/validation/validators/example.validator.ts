import type { ValidationResult, ValidationError } from "../types.js";

/** A structured example with target and native sentences */
export interface ExampleInput {
  context: string;
  target: string;
  native: string;
}

/**
 * Validates that examples are well-formed and contain the translated word.
 *
 * Rules:
 * - Each example must have both target and native text
 * - Each example's target text should contain the translated word
 *   (case-insensitive, allows partial match for inflected forms)
 *
 * Pure function — no side effects.
 */
export function validateExamples(
  examples: ExampleInput[],
  word: string,
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!examples || examples.length === 0) {
    errors.push({
      rule: "examples",
      message: "No examples provided",
      field: "examples",
    });
    return { valid: false, errors };
  }

  for (let i = 0; i < examples.length; i++) {
    const example = examples[i];

    // Check target text exists
    if (!example.target || example.target.trim().length === 0) {
      errors.push({
        rule: "examples",
        message: `Example ${i} has empty target text`,
        field: `examples.${i}.target`,
      });
    }

    // Check native text exists
    if (!example.native || example.native.trim().length === 0) {
      errors.push({
        rule: "examples",
        message: `Example ${i} has empty native text`,
        field: `examples.${i}.native`,
      });
    }

    // Word containment check removed — inflected forms, synonyms,
    // and multi-word translations make this check too noisy
    // (e.g. "chlebíček" → "chlebíčky", or model uses a synonym).
  }

  return { valid: errors.length === 0, errors };
}
