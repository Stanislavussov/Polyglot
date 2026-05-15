import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

describe("validateExamples", () => {
  it("returns valid for well-formed examples", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Hippokratova přísaha obsahuje důležitá slova.",
          
        },
      ],
      "slova",
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when no examples provided", () => {
    const result = validateExamples([], "hello");
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("examples");
    expect(result.errors[0].message).toContain("No examples");
  });

  it("fails for empty target text", () => {
    const result = validateExamples([{ context: "neutral", target: "" }], "word");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("fails for empty target text", () => {
    const result = validateExamples(
      [{ context: "neutral", target: "" }],
      "ahoj",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("examples");
  });

  it("accepts any context value", () => {
    const result = validateExamples(
      [{ context: "any-context", target: "Hippokratova přísaha obsahuje důležitá slova." }],
      "ahoj",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts all valid context values", () => {
    const contexts = ["neutral", "colloquial", "professional"] as const;
    for (const context of contexts) {
      const result = validateExamples([{ context, target: "Some target text." }], "word");
      expect(result.valid).toBe(true);
    }
  });

  it("passes when target text does not contain the word (no word containment check)", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Completely unrelated sentence here.",
          
        },
      ],
      "ahoj",
    );
    expect(result.valid).toBe(true);
  });

  it("validates multiple examples and reports all errors", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Good example with word hello",
          
        },
        {
          context: "colloquial",
          target: "",
          
        },
      ],
      "hello",
    );
    expect(result.valid).toBe(false);
    // Empty target for example 1
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("includes field path with example index", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "",
          
        },
      ],
      "specific_word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toMatch(/examples\.0/);
  });
});
