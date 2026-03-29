import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

describe("validateExamples", () => {
  it("returns valid for well-formed examples", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Hippokratova přísaha obsahuje důležitá slova.",
          register: "нейтральный",
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
    const result = validateExamples(
      [{ context: "neutral", target: "", register: "neutral" }],
      "word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("fails for empty register label", () => {
    const result = validateExamples(
      [{ context: "neutral", target: "Some target text with word", register: "" }],
      "word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("register"))).toBe(true);
  });

  it("fails for invalid context value", () => {
    const result = validateExamples(
      [
        {
          context: "formal", // old value — no longer valid
          target: "Some target text.",
          register: "formal",
        },
      ],
      "word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("context"))).toBe(true);
    expect(result.errors[0].message).toContain("formal");
    expect(result.errors[0].message).toContain("neutral");
  });

  it("accepts all valid context values", () => {
    const contexts = ["neutral", "colloquial", "professional"] as const;
    for (const context of contexts) {
      const result = validateExamples(
        [{ context, target: "Some target text.", register: "label" }],
        "word",
      );
      expect(result.valid).toBe(true);
    }
  });

  it("passes when target text does not contain the word (no word containment check)", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Completely unrelated sentence here.",
          register: "нейтральный",
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
          register: "нейтральный",
        },
        {
          context: "colloquial",
          target: "",
          register: "",
        },
      ],
      "hello",
    );
    expect(result.valid).toBe(false);
    // Empty target + empty register for example 1
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("includes field path with example index", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "",
          register: "нейтральный",
        },
      ],
      "specific_word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toMatch(/examples\.0/);
  });
});
