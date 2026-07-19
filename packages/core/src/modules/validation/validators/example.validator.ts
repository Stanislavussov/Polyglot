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
    if (!sharesExpressionToken(firstTarget, word)) {
      errors.push({
        rule: "examples",
        message: `First example should demonstrate the main translation "${word}"`,
        field: "examples.0.target",
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates the top-level `sourceUsage.examples` (the source-language usage
 * examples shown when translating FROM a learning language).
 *
 * Each example's `target` must be a real source-language sentence, not the bare
 * headword echoed back. A lite model sometimes collapsed the example to just the
 * word (e.g. target "nevertheless" with the whole sentence pushed into `native`),
 * which rendered as "💬 nevertheless (…)" instead of a full sentence. This guard
 * makes that a blocking validation error so the pipeline repairs it deterministically.
 *
 * "Collapsed" = the target contributes no token beyond the headword's own tokens.
 *
 * Pure function — no side effects.
 */
export function validateSourceUsageExamples(examples: ExampleInput[], headword: string): ValidationResult {
  const errors: ValidationError[] = [];
  const headwordTokens = new Set(tokenize(headword));

  for (let i = 0; i < examples.length; i++) {
    const target = examples[i]?.target ?? "";
    const targetTokens = tokenize(target);
    if (targetTokens.length === 0) continue; // empty target is caught by the shared empty-target rule

    const addsNewWords = targetTokens.some((token) => !headwordTokens.has(token));
    if (!addsNewWords) {
      errors.push({
        rule: "examples",
        message: `Source-usage example ${i} must be a full sentence using "${headword}", not just the word itself`,
        field: `sourceUsage.examples.${i}.target`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function shouldValidateFirstExampleHeadword(word: string, expressionType?: ExpressionType): boolean {
  if (expressionType === "idiomatic_equivalent") return false;
  return tokenize(word).some((token) => token.length >= 3);
}

/**
 * True when the first example demonstrates the translation — i.e. it shares at
 * least one significant (>= 3 char) token of the translation, matched by stem so
 * inflected forms count.
 *
 * Deliberately "at least one significant token", not "every token". Requiring
 * every token to appear verbatim over-rejected correct output: a first example
 * naturally inflects or reorders a multi-word translation and drops/changes
 * function words, so a leading article ("der Spott, -e" demonstrated by "den
 * Spott …") or an idiom's particles ("etwas auf dem Kasten haben" shown as "…
 * was auf dem Kasten") made the check fail on a good translation. The head
 * content word is enough to show the example is on-topic; a genuinely unrelated
 * example shares no token and still fails.
 */
function sharesExpressionToken(target: string, expression: string): boolean {
  const targetTokens = tokenize(target);
  const expressionTokens = tokenize(expression).filter((token) => token.length >= 3);

  return (
    expressionTokens.length > 0 && expressionTokens.some((token) => targetTokens.some((item) => sameStem(token, item)))
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
