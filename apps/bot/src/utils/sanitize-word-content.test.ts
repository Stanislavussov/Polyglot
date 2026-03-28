import type { TranslateOutput } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { sanitizeForStorage } from "./sanitize-word-content.js";

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  register: "neutral",
  translations: {
    cs: {
      text: "ahoj",
      cefr: "A1",
      transcription: "ˈahoj",
      register: "colloquial",
      synonyms: [{ text: "nazdar", register: "colloquial" }],
      examples: [{ context: "colloquial", target: "Ahoj!", native: "Hello!" }],
      alternatives: [{ text: "dobrý den", register: "neutral", synonyms: [] }],
      expressionType: "literal",
      equivalentNote: "Standard greeting",
    },
  },
  needsReview: true,
  dictionaryContext: {
    word: "hello",
    pos: "interjection",
    glosses: ["a greeting"],
    langCode: "en",
  },
};

describe("sanitizeForStorage", () => {
  it("strips needsReview field", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect("needsReview" in result).toBe(false);
  });

  it("strips dictionaryContext field", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect("dictionaryContext" in result).toBe(false);
  });

  it("strips original field", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect("original" in result).toBe(false);
  });

  it("strips sourceLang field", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect("sourceLang" in result).toBe(false);
  });

  it("retains emoji", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect(result.emoji).toBe("👋");
  });

  it("retains register", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect(result.register).toBe("neutral");
  });

  it("retains translations with nested structure (deep equality)", () => {
    const result = sanitizeForStorage(sampleOutput);
    expect(result.translations).toEqual(sampleOutput.translations);
  });

  it("does not mutate the input TranslateOutput object", () => {
    const original = JSON.parse(JSON.stringify(sampleOutput));
    sanitizeForStorage(sampleOutput);
    expect(sampleOutput).toEqual(original);
  });

  it("works when optional fields are absent", () => {
    const minimal: TranslateOutput = {
      original: "test",
      sourceLang: "en",
      emoji: "🔤",
      register: "neutral",
      translations: {},
    };
    const result = sanitizeForStorage(minimal);
    expect(result).toEqual({
      emoji: "🔤",
      register: "neutral",
      translations: {},
    });
  });
});
