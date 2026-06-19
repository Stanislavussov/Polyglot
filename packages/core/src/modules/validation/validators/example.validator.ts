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
    const firstTarget = examples[0]?.target ?? "";
    if (!containsInflectedExpression(firstTarget, word)) {
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
  return tokenize(word).some((token) => token.length >= 3);
}

function containsInflectedExpression(target: string, expression: string): boolean {
  const targetTokens = tokenize(target);
  const expressionTokens = tokenize(expression).filter((token) => token.length >= 3);

  return (
    expressionTokens.length > 0 && expressionTokens.every((token) => targetTokens.some((item) => sameStem(token, item)))
  );
}

function sameStem(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;

  const prefixLength = Math.min(4, left.length, right.length);
  return left.slice(0, prefixLength) === right.slice(0, prefixLength);
}

function tokenize(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
