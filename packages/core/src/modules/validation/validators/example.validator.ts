import type { ValidationError, ValidationResult } from "../types.js";

/** Expression type — literal or idiomatic equivalent */
export type ExpressionType = "literal" | "idiomatic_equivalent";

/** Valid example context labels (Task 31: "formal" renamed to "neutral") */
export const VALID_EXAMPLE_CONTEXTS = ["neutral", "colloquial", "professional"] as const;
export type ExampleContext = (typeof VALID_EXAMPLE_CONTEXTS)[number];

/**
 * A structured example with target sentence and register label.
 * Task 31: `native` removed (token savings), `register` added (inline label).
 */
export interface ExampleInput {
  context: string;
  target: string;
  register: string;
}

/**
 * Validates that examples are well-formed.
 *
 * Rules:
 * - At least one example must be present
 * - Each example must have non-empty target text
 * - Each example must have non-empty register label
 * - Each example's context must be one of: neutral, colloquial, professional
 * - When expressionType is "idiomatic_equivalent", word-matching is relaxed:
 *   only verifies examples are non-empty with target and register
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

    // Check target text exists
    if (!example.target || example.target.trim().length === 0) {
      errors.push({
        rule: "examples",
        message: `Example ${i} has empty target text`,
        field: `examples.${i}.target`,
      });
    }

    // Check register label exists
    if (!example.register || example.register.trim().length === 0) {
      errors.push({
        rule: "examples",
        message: `Example ${i} has empty register label`,
        field: `examples.${i}.register`,
      });
    }

    // Check context is a valid value
    if (
      example.context &&
      !VALID_EXAMPLE_CONTEXTS.includes(example.context as ExampleContext)
    ) {
      errors.push({
        rule: "examples",
        message: `Example ${i} has invalid context "${example.context}" — expected one of: ${VALID_EXAMPLE_CONTEXTS.join(", ")}`,
        field: `examples.${i}.context`,
      });
    }

    // Word containment check removed — inflected forms, synonyms,
    // and multi-word translations make this check too noisy
    // (e.g. "chlebíček" → "chlebíčky", or model uses a synonym).
  }

  return { valid: errors.length === 0, errors };
}
