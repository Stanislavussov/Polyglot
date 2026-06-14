import type { ValidationError, ValidationResult } from "../types.js";

/** Expression type — literal or idiomatic equivalent */
export type ExpressionType = "literal" | "idiomatic_equivalent";

/**
 * A structured example with target sentence.
 */
export interface ExampleInput {
  context: string;
  target: string;
  native?: string | null;
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
  word: string,
  expressionType?: ExpressionType,
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
  }

  if (shouldValidateFirstExampleHeadword(word, expressionType)) {
    const firstTarget = examples[0]?.target.toLocaleLowerCase() ?? "";
    const normalizedWord = word.toLocaleLowerCase();
    if (!firstTarget.includes(normalizedWord)) {
      errors.push({
        rule: "examples",
        message: `First example should demonstrate the main translation "${word}"`,
        field: "examples.0.target",
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function shouldValidateFirstExampleHeadword(word: string, expressionType?: ExpressionType): boolean {
  if (expressionType === "idiomatic_equivalent") return false;

  const trimmed = word.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.includes(" ")) return false;
  if (!/^[a-z]+$/i.test(trimmed)) return false;

  return true;
}
