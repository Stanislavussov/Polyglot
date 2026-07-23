import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

/**
 * Tests for Task 10: Example validator with expressionType parameter.
 * Updated for Task 31: Examples use `register` instead of `native`, `neutral` instead of `formal`.
 *
 * Verifies that the validator accepts the expressionType parameter
 * and behaves correctly for both literal and idiomatic_equivalent.
 */

describe("validateExamples — idiomatic equivalents", () => {
  const validExamples = [
    {
      context: "neutral" as const,
      target: "You can't have your cake and eat it too in this situation.",
    },
    {
      context: "colloquial" as const,
      target: "That's like having your cake and eating it too.",
    },
  ];

  it("accepts a literal translation demonstrated by its examples", () => {
    const result = validateExamples(validExamples, "cake");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts an idiomatic equivalent demonstrated by its examples", () => {
    const result = validateExamples(validExamples, "Having your cake and eating it too");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a single-word translation repeated across examples", () => {
    const result = validateExamples(validExamples, "cake");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("still fails when there are no examples at all", () => {
    const result = validateExamples([], "idiom");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("No examples");
  });

  it("still fails when an example target is empty", () => {
    const result = validateExamples([{ context: "neutral", target: "" }], "idiom");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("idiomatic examples that don't repeat the phrase verbatim still pass", () => {
    // An idiomatic equivalent used in context may not repeat the full idiom
    // verbatim, and one of the examples may paraphrase it entirely. Coverage is
    // a majority rule, not an every-example rule, so this stays valid.
    const idiomaticExamples = [
      {
        context: "neutral" as const,
        target: "In this negotiation, she had her cake and ate it too.",
      },
      {
        context: "colloquial" as const,
        target: "She managed to get the best of both worlds.",
      },
    ];
    const result = validateExamples(idiomaticExamples, "Having your cake and eating it too");
    expect(result.valid).toBe(true);
  });

  it("rejects idiomatic examples that never demonstrate the equivalent", () => {
    // Previously skipped outright for idiomatic_equivalent, which let an idiom
    // card be illustrated entirely by other expressions.
    const idiomaticExamples = [
      {
        context: "neutral" as const,
        target: "In this negotiation, everyone got what they wanted.",
      },
      {
        context: "colloquial" as const,
        target: "She managed to get the best of both worlds.",
      },
    ];
    const result = validateExamples(idiomaticExamples, "Having your cake and eating it too");
    expect(result.valid).toBe(false);
  });

  it("literal examples that don't contain simple words fail conservatively", () => {
    const examples = [
      {
        context: "neutral" as const,
        target: "This is a completely different sentence.",
      },
    ];
    const result = validateExamples(examples, "hello");
    expect(result.valid).toBe(false);
  });
});
