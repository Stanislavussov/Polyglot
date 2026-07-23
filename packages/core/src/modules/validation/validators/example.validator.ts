import type { ValidationError, ValidationResult } from "../types.js";

/** Expression type — literal or idiomatic equivalent */
export type ExpressionType = "literal" | "idiomatic_equivalent";

/** Shortest token that counts as carrying meaning when matching a translation. */
const MIN_SIGNIFICANT_TOKEN = 3;

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
 * - The examples must demonstrate `translationText` (see `checkHeadwordDemonstration`)
 *
 * Pure function — no side effects.
 */
export function validateExamples(
  examples: ExampleInput[],
  translationText: string,
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

  errors.push(...checkHeadwordDemonstration(examples, translationText, expressionType));

  return { valid: errors.length === 0, errors };
}

/**
 * Checks that the examples actually demonstrate the translation.
 *
 * Two regimes, split by how many significant tokens the translation has, because the
 * token matcher is only trustworthy on the multi-word side:
 *
 * - **Multi-word** (>= 2 significant tokens): at least half the examples must demonstrate
 *   it. This is the rule that catches the observed defect — on RU "какать кирпичами" the
 *   English block used "to shit bricks" once and then drifted to "scared stiff" and
 *   "petrified", and the Czech block put the calque "kadit cihly" in the headword while its
 *   own examples used the real idiom. Idiomatic equivalents used to skip this check
 *   entirely, so an idiom card got no example validation at all.
 *
 * - **Single word**: only the first example is checked, and idiomatic equivalents are
 *   skipped — the pre-existing rule, deliberately left alone. Extending coverage here
 *   would reject large classes of correct output, because `sameStem` needs an exact match
 *   below 5 characters and a shared 4-character prefix above it. Measured failures on
 *   correct translations: de "anrufen" (0/3 — separable prefix splits off in every finite
 *   clause), pl "iść" (0/3), kk "бару" (0/3), ru "спать" (1/3), it "essere" (1/3). That is
 *   core vocabulary, and over-rejecting it is what drove ~36% of translations into
 *   needs_review once before. Fixing it needs real stemming, not a wider threshold.
 *
 * "At least half" rather than "all" is also deliberate: a functional equivalent may be
 * paraphrased in one example, and matching is per-token by stem (see
 * `sharesExpressionToken`) so inflection and dropped function words still pass.
 */
function checkHeadwordDemonstration(
  examples: ExampleInput[],
  translationText: string,
  expressionType?: ExpressionType,
): ValidationError[] {
  const significantTokens = tokenize(translationText).filter((token) => token.length >= MIN_SIGNIFICANT_TOKEN);
  if (significantTokens.length === 0) return [];

  const indexed = examples
    .map((example, index) => ({ example, index }))
    .filter(({ example }) => (example.target ?? "").trim().length > 0);
  if (indexed.length === 0) return [];

  if (significantTokens.length < 2) {
    if (expressionType === "idiomatic_equivalent") return [];
    const first = indexed[0];
    if (first.index !== 0 || sharesExpressionToken(first.example.target, translationText)) return [];
    // Distinct rule ("first-example", not the generic "examples") so the service
    // can down-rank ONLY this low-confidence single-word check to advisory
    // severity. `sameStem` needs an exact match below 5 chars and a shared
    // 4-char prefix above it, so it over-rejects correct inflected core
    // vocabulary (de "anrufen", pl "iść", kk "бару", ru "спать", it "essere") —
    // a false failure here must not force needs_review. The multi-word,
    // no-examples, and empty-target checks keep the blocking "examples" rule.
    return [
      {
        rule: "first-example",
        message: `First example should demonstrate the main translation "${translationText}"`,
        field: "examples.0.target",
      },
    ];
  }

  const uncovered = indexed.filter(({ example }) => !sharesExpressionToken(example.target, translationText));
  const covered = indexed.length - uncovered.length;
  if (covered >= Math.ceil(indexed.length / 2)) return [];

  // The message deliberately does not try to name the expression the examples used
  // instead. Identifying it means guessing which shared words form a real expression, and
  // every cheap heuristic for that reassembles function words into phrases nobody said
  // ("было очень", "that when") — which, quoted back as the expression natives supposedly
  // use, would corrupt a headword that was merely mis-illustrated. Deciding whether a
  // headword is an unattested calque is a knowledge question, and belongs to the semantic
  // judge rather than to token arithmetic.
  const message = `Only ${covered} of ${indexed.length} examples demonstrate the translation "${translationText}" — at least half must use it rather than a synonym. If the examples are right and the translation is the odd one out, replace the translation instead of rewriting them.`;

  // Anchor on the first example that fails so the repair step gets a concrete location.
  return [{ rule: "examples", message, field: `examples.${uncovered[0].index}.target` }];
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

/**
 * True when an example demonstrates the translation — i.e. it shares at
 * least one significant (>= 3 char) token of the translation, matched by stem so
 * inflected forms count.
 *
 * Deliberately "at least one significant token", not "every token". Requiring
 * every token to appear verbatim over-rejected correct output: an example
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
