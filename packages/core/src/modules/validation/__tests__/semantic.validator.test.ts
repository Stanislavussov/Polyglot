import { describe, it, expect } from "vitest";
import { validateSemantic } from "../validators/semantic.validator.js";

describe("validateSemantic", () => {
  it("returns valid for a proper translation", () => {
    const result = validateSemantic("hello", "ahoj");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when translation equals original (exact)", () => {
    const result = validateSemantic("hello", "hello");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "semantic")).toBe(true);
    expect(result.errors[0].message).toContain("identical");
  });

  it("fails when translation equals original (case-insensitive)", () => {
    const result = validateSemantic("Hello", "HELLO");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("identical"))).toBe(true);
  });

  it("fails for empty translation", () => {
    const result = validateSemantic("hello", "");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("empty"))).toBe(true);
  });

  it("fails for whitespace-only translation", () => {
    const result = validateSemantic("hello", "   ");
    expect(result.valid).toBe(false);
  });

  it("fails for hallucination pattern 'N/A'", () => {
    const result = validateSemantic("hello", "N/A");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("hallucination"))).toBe(true);
  });

  it("fails for hallucination pattern 'I cannot'", () => {
    const result = validateSemantic("hello", "I cannot translate this");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("hallucination"))).toBe(true);
  });

  it("fails for hallucination pattern 'I can't'", () => {
    const result = validateSemantic("hello", "I can't do that");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("hallucination"))).toBe(true);
  });

  it("fails for hallucination pattern '—' (em dash)", () => {
    const result = validateSemantic("hello", "—");
    expect(result.valid).toBe(false);
  });

  it("fails for hallucination pattern '...'", () => {
    const result = validateSemantic("hello", "...");
    expect(result.valid).toBe(false);
  });

  it("fails for hallucination pattern 'undefined'", () => {
    const result = validateSemantic("hello", "undefined");
    expect(result.valid).toBe(false);
  });

  it("fails for hallucination pattern 'null'", () => {
    const result = validateSemantic("hello", "null");
    expect(result.valid).toBe(false);
  });

  it("passes for a legitimate translation that happens to be short", () => {
    const result = validateSemantic("cat", "кот");
    expect(result.valid).toBe(true);
  });

  it("sets field to 'text' on errors", () => {
    const result = validateSemantic("hello", "N/A");
    for (const err of result.errors) {
      expect(err.field).toBe("text");
    }
  });
});
