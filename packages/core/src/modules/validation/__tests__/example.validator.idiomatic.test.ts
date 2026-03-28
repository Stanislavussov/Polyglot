import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

/**
 * Tests for Task 10: Example validator with expressionType parameter.
 *
 * Verifies that the validator accepts the expressionType parameter
 * and behaves correctly for both literal and idiomatic_equivalent.
 */

describe("validateExamples — expressionType parameter", () => {
  const validExamples = [
    {
      context: "formal",
      target: "You can't have your cake and eat it too in this situation.",
      native: "V této situaci nemůžete mít obojí.",
    },
    {
      context: "colloquial",
      target: "That's like having your cake and eating it too.",
      native: "To je jako mít obojí.",
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
      [{ context: "formal", target: "", native: "Some native text." }],
      "idiom",
      "idiomatic_equivalent",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("still fails for empty native with idiomatic_equivalent", () => {
    const result = validateExamples(
      [{ context: "formal", target: "Some target text.", native: "" }],
      "idiom",
      "idiomatic_equivalent",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("native"))).toBe(true);
  });

  it("idiomatic examples that don't repeat the phrase verbatim still pass", () => {
    // This is the key scenario: an idiomatic equivalent used in context
    // may not repeat the full idiom verbatim
    const idiomaticExamples = [
      {
        context: "formal",
        target: "In this negotiation, everyone got what they wanted.",
        native: "V tomto vyjednávání každý dostal, co chtěl.",
      },
      {
        context: "colloquial",
        target: "She managed to get the best of both worlds.",
        native: "Podařilo se jí mít obojí.",
      },
    ];
    const result = validateExamples(idiomaticExamples, "Having your cake and eating it too", "idiomatic_equivalent");
    expect(result.valid).toBe(true);
  });

  it("literal examples that don't contain the word still pass (no word containment check)", () => {
    // Word containment was already removed for all expression types
    const examples = [
      {
        context: "formal",
        target: "This is a completely different sentence.",
        native: "Toto je úplně jiná věta.",
      },
    ];
    const result = validateExamples(examples, "hello", "literal");
    expect(result.valid).toBe(true);
  });
});
