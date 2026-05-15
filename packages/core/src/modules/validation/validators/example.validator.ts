import type { ValidationError, ValidationResult } from "../types.js";

/** Expression type — literal or idiomatic equivalent */
export type ExpressionType = "literal" | "idiomatic_equivalent";

/**
 * A structured example with target sentence.
 */
export interface ExampleInput {
  context: string;
  target: string;
}

/**
 * Validates that examples are well-formed.
 *
 * Rules:
 * - At least one example must be present
 * - Each example must have non-empty target text
 *
 * Pure function — no side effects.
 */
export function validateExamples(
  examples: ExampleInput[],
  _word: string,
  _expressionType?: ExpressionType,
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

    if (!example.target || example.target.trim().length === 0) {
      errors.push({
        rule: "examples",
        message: `Example ${i} has empty target text`,
        field: `examples.${i}.target`,
      });
    }

    // Word containment check removed — inflected forms, synonyms,
    // and multi-word translations make this check too noisy
    // (e.g. "chlebíček" → "chlebíčky", or model uses a synonym).
  }

  return { valid: errors.length === 0, errors };
}
