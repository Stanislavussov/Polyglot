import { describe, it, expect } from "vitest";
import { validateExamples } from "../validators/example.validator.js";

describe("validateExamples", () => {
  it("returns valid for well-formed examples containing the word", () => {
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
    const result = validateExamples(
      [{ context: "formal", target: "", native: "Some native text" }],
      "word",
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.field?.includes("target")),
    ).toBe(true);
  });

  it("fails for empty native text", () => {
    const result = validateExamples(
      [{ context: "formal", target: "Some target text with word", native: "" }],
      "word",
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.field?.includes("native")),
    ).toBe(true);
  });

  it("fails when target text does not contain the word", () => {
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
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("does not contain")),
    ).toBe(true);
  });

  it("passes for case-insensitive word match", () => {
    const result = validateExamples(
      [
        {
          context: "formal",
          target: "AHOJ, jak se máš?",
          native: "Hello, how are you?",
        },
      ],
      "ahoj",
    );
    expect(result.valid).toBe(true);
  });

  it("passes for stem match on inflected forms", () => {
    // "slova" is inflected form of "slovo" — stem "slov" should match
    const result = validateExamples(
      [
        {
          context: "formal",
          target: "Ta slova jsou důležitá.",
          native: "Those words are important.",
        },
      ],
      "slovo",
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
          target: "Unrelated sentence completely",
          native: "Also unrelated",
        },
      ],
      "specific_word",
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toMatch(/examples\.0/);
  });
});
