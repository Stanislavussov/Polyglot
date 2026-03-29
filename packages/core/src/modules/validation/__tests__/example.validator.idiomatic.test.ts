import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

/**
 * Tests for Task 10: Example validator with expressionType parameter.
 * Updated for Task 31: Examples use `register` instead of `native`, `neutral` instead of `formal`.
 *
 * Verifies that the validator accepts the expressionType parameter
 * and behaves correctly for both literal and idiomatic_equivalent.
 */

describe("validateExamples — expressionType parameter", () => {
  const validExamples = [
    {
      context: "neutral" as const,
      target: "You can't have your cake and eat it too in this situation.",
      register: "neutral",
    },
    {
      context: "colloquial" as const,
      target: "That's like having your cake and eating it too.",
      register: "colloquial",
    },
  ];

  it("accepts expressionType 'literal' — validates normally", () => {
    const result = validateExamples(validExamples, "cake", "literal");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts expressionType 'idiomatic_equivalent' — validates normally", () => {
    const result = validateExamples(validExamples, "Having your cake and eating it too", "idiomatic_equivalent");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("works without expressionType (backward compatible)", () => {
    const result = validateExamples(validExamples, "word");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("still fails for empty examples with idiomatic_equivalent", () => {
    const result = validateExamples([], "idiom", "idiomatic_equivalent");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("No examples");
  });

  it("still fails for empty target with idiomatic_equivalent", () => {
    const result = validateExamples(
      [{ context: "neutral", target: "", register: "нейтральный" }],
      "idiom",
      "idiomatic_equivalent",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("still fails for empty register with idiomatic_equivalent", () => {
    const result = validateExamples(
      [{ context: "neutral", target: "Some target text.", register: "" }],
      "idiom",
      "idiomatic_equivalent",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("register"))).toBe(true);
  });

  it("idiomatic examples that don't repeat the phrase verbatim still pass", () => {
    // This is the key scenario: an idiomatic equivalent used in context
    // may not repeat the full idiom verbatim
    const idiomaticExamples = [
      {
        context: "neutral" as const,
        target: "In this negotiation, everyone got what they wanted.",
        register: "нейтральный",
      },
      {
        context: "colloquial" as const,
        target: "She managed to get the best of both worlds.",
        register: "разговорный",
      },
    ];
    const result = validateExamples(idiomaticExamples, "Having your cake and eating it too", "idiomatic_equivalent");
    expect(result.valid).toBe(true);
  });

  it("literal examples that don't contain the word still pass (no word containment check)", () => {
    // Word containment was already removed for all expression types
    const examples = [
      {
        context: "neutral" as const,
        target: "This is a completely different sentence.",
        register: "нейтральный",
      },
    ];
    const result = validateExamples(examples, "hello", "literal");
    expect(result.valid).toBe(true);
  });
});
