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
    const result = validateExamples([{ context: "neutral", target: "" }], "ahoj");
    expect(result.valid).toBe(false);
    expect(result.errors[0].rule).toBe("examples");
  });

  it("accepts any context value", () => {
    const result = validateExamples(
      [{ context: "any-context", target: "Ahoj, Hippokratova přísaha obsahuje důležitá slova." }],
      "ahoj",
    );
    expect(result.valid).toBe(true);
  });

  it("accepts all valid context values", () => {
    const contexts = ["neutral", "colloquial", "professional"] as const;
    for (const context of contexts) {
      const result = validateExamples([{ context, target: "Some word in target text." }], "word");
      expect(result.valid).toBe(true);
    }
  });

  it("fails when a simple literal first example does not contain the main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Completely unrelated sentence here.",
        },
      ],
      "ahoj",
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "examples.0.target")).toBe(true);
  });

  it("rejects an unrelated first example for a non-ASCII main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Completely unrelated sentence here.",
        },
      ],
      "chlebíček",
    );
    expect(result.valid).toBe(false);
  });

  it("validates a multi-word main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Vláda chce omezit používání plastů.",
        },
      ],
      "postupně ukončit",
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.field === "examples.0.target")).toBe(true);
  });

  it("accepts normal Czech inflection of a multi-word main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Firma postupně ukončila výrobu starého modelu.",
        },
      ],
      "postupně ukončit",
    );

    expect(result.valid).toBe(true);
  });

  it("accepts normal Russian inflection of a multi-word main translation", () => {
    const result = validateExamples(
      [
        {
          context: "neutral",
          target: "Компания постепенно откажется от устаревшей системы.",
        },
      ],
      "постепенно отказаться",
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
