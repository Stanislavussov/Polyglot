/**
 * Tests that dictionary context is NOT rendered in the user-facing card.
 *
 * Dictionary context (POS, glosses, formTags) is used only to enrich
 * the AI prompt via the context-enrichment layer. It must never appear
 * in the Telegram translation card.
 */
import { describe, it, expect } from "vitest";
import { renderTranslation } from "../renderers/translation.renderer.js";
import type { TranslateOutput } from "@polyglot/core";

const baseOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  register: "neutral",
  translations: {
    cs: {
      text: "ahoj",
      cefr: "A1",
      register: "colloquial",
      synonyms: [],
      examples: [],
    },
  },
};

describe("renderTranslation — dictionary context is AI-only", () => {
  it("does not render dictionary context when present", () => {
    const output: TranslateOutput = {
      ...baseOutput,
      dictionaryContext: {
        word: "hello",
        pos: "noun",
        glosses: ["a greeting"],
        langCode: "en",
      },
    };

    const result = renderTranslation(output, "en");

    expect(result).not.toContain("Part of speech");
    expect(result).not.toContain("📖");
    expect(result).not.toContain("a greeting");
    expect(result).not.toContain("Expression detected");
  });

  it("does not render phrase/idiom hints", () => {
    const output: TranslateOutput = {
      ...baseOutput,
      dictionaryContext: {
        word: "скрести по сусекам",
        pos: "phrase",
        glosses: ["to scrape the bottom of the barrel"],
        langCode: "ru",
      },
    };

    const result = renderTranslation(output, "en");

    expect(result).not.toContain("Expression detected");
    expect(result).not.toContain("скрести по сусекам");
    expect(result).not.toContain("scrape the bottom");
    expect(result).not.toContain("📖");
  });

  it("does not render idiom context", () => {
    const output: TranslateOutput = {
      ...baseOutput,
      dictionaryContext: {
        word: "сорока на хвосте принесла",
        pos: "idiom",
        glosses: ["a little bird told me"],
        langCode: "ru",
      },
    };

    const result = renderTranslation(output, "en");

    expect(result).not.toContain("Expression detected");
    expect(result).not.toContain("сорока на хвосте принесла");
    expect(result).not.toContain("a little bird told me");
  });

  it("does not render dictionary context even when glosses are present", () => {
    const output: TranslateOutput = {
      ...baseOutput,
      dictionaryContext: {
        word: "run",
        pos: "verb",
        glosses: ["to move quickly", "to operate", "to flow"],
        langCode: "en",
      },
    };

    const result = renderTranslation(output, "en");

    expect(result).not.toContain("to move quickly");
    expect(result).not.toContain("to operate");
    expect(result).not.toContain("to flow");
    expect(result).not.toContain("Part of speech");
  });

  it("renders normally without dictionary context", () => {
    const result = renderTranslation(baseOutput, "en");

    expect(result).toContain("👋 <b>hello</b>");
    expect(result).toContain("Register: neutral");
    expect(result).toContain("<b>ahoj</b>");
  });

  it("needsReview still renders without dictionary context hint above it", () => {
    const output: TranslateOutput = {
      ...baseOutput,
      needsReview: true,
      dictionaryContext: {
        word: "hello",
        pos: "noun",
        glosses: ["a greeting"],
        langCode: "en",
      },
    };

    const result = renderTranslation(output, "en");

    expect(result).toContain("inaccuracies");
    expect(result).not.toContain("Part of speech");
    expect(result).not.toContain("📖");
  });
});
