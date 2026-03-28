import { describe, expect, it } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

describe("validateExamples", () => {
  it("returns valid for well-formed examples", () => {
    const result = validateExamples(
      [
        {
          context: "formal",
          target: "Hippokratova přísaha obsahuje důležitá slova.",
          native: "The Hippocratic Oath contains important words.",
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
    const result = validateExamples([{ context: "formal", target: "", native: "Some native text" }], "word");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("target"))).toBe(true);
  });

  it("fails for empty native text", () => {
    const result = validateExamples([{ context: "formal", target: "Some target text with word", native: "" }], "word");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("native"))).toBe(true);
  });

  it("passes when target text does not contain the word (no word containment check)", () => {
    const result = validateExamples(
      [
        {
          context: "formal",
          target: "Completely unrelated sentence here.",
          native: "Some native text.",
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
          context: "formal",
          target: "Good example with word hello",
          native: "Dobrý příklad s slovem ahoj",
        },
        {
          context: "colloquial",
          target: "",
          native: "",
        },
      ],
      "hello",
    );
    expect(result.valid).toBe(false);
    // Empty target + empty native for example 1
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("includes field path with example index", () => {
    const result = validateExamples(
      [
        {
          context: "formal",
          target: "",
          native: "Also unrelated",
        },
      ],
      "specific_word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toMatch(/examples\.0/);
  });
});
