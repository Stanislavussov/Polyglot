/**
 * Tests for dictionary context rendering in translation.renderer.
 * Covers renderDictionaryHint and its integration with renderTranslation.
 */
import { describe, it, expect } from "vitest";
import {
  renderTranslation,
  renderDictionaryHint,
} from "../renderers/translation.renderer.js";
import type { TranslateOutput, DictionaryContext } from "@polyglot/core";

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

describe("renderDictionaryHint", () => {
  it("renders phrase detection for pos=phrase", () => {
    const dc: DictionaryContext = {
      word: "что ли",
      pos: "phrase",
      glosses: ["or something", "perhaps"],
      langCode: "ru",
    };

    const result = renderDictionaryHint(dc, "en");

    expect(result).toContain("Phrase detected");
    expect(result).toContain("что ли");
    expect(result).toContain("📖");
    expect(result).toContain("or something; perhaps");
  });

  it("renders idiom detection for pos=idiom", () => {
    const dc: DictionaryContext = {
      word: "kick the bucket",
      pos: "idiom",
      glosses: ["to die"],
      langCode: "en",
    };

    const result = renderDictionaryHint(dc, "en");

    expect(result).toContain("Idiom detected");
    expect(result).toContain("kick the bucket");
    expect(result).toContain("to die");
  });

  it("renders part of speech for regular pos", () => {
    const dc: DictionaryContext = {
      word: "house",
      pos: "noun",
      glosses: ["a building for living in"],
      langCode: "en",
    };

    const result = renderDictionaryHint(dc, "en");

    expect(result).toContain("Part of speech: noun");
    expect(result).toContain("a building for living in");
  });

  it("truncates glosses to 3 entries", () => {
    const dc: DictionaryContext = {
      word: "run",
      pos: "verb",
      glosses: ["to move quickly", "to operate", "to flow", "to manage", "to flee"],
      langCode: "en",
    };

    const result = renderDictionaryHint(dc, "en");

    expect(result).toContain("to move quickly");
    expect(result).toContain("to operate");
    expect(result).toContain("to flow");
    expect(result).not.toContain("to manage");
    expect(result).not.toContain("to flee");
  });

  it("renders without glosses section when glosses are empty", () => {
    const dc: DictionaryContext = {
      word: "hmm",
      pos: "interjection",
      glosses: [],
      langCode: "en",
    };

    const result = renderDictionaryHint(dc, "en");

    expect(result).toContain("Part of speech: interjection");
    expect(result).not.toContain("📖");
  });

  it("escapes HTML in glosses and word", () => {
    const dc: DictionaryContext = {
      word: "a <b>bold</b> word",
      pos: "noun",
      glosses: ["definition with <i>html</i> & entities"],
      langCode: "en",
    };

    const result = renderDictionaryHint(dc, "en");

    expect(result).not.toContain("<b>");
    expect(result).not.toContain("<i>");
    expect(result).toContain("&amp;");
  });

  it("renders in Russian locale", () => {
    const dc: DictionaryContext = {
      word: "что ли",
      pos: "phrase",
      glosses: ["or something"],
      langCode: "ru",
    };

    const result = renderDictionaryHint(dc, "ru");

    expect(result).toContain("что ли");
  });
});

describe("renderTranslation — with dictionary context", () => {
  it("includes dictionary hint when dictionaryContext is present", () => {
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

    expect(result).toContain("Part of speech: noun");
    expect(result).toContain("📖 a greeting");
  });

  it("does not render dictionary section when dictionaryContext is absent", () => {
    const result = renderTranslation(baseOutput, "en");

    expect(result).not.toContain("Part of speech");
    expect(result).not.toContain("Phrase detected");
    expect(result).not.toContain("Idiom detected");
  });

  it("renders dictionary hint before needsReview warning", () => {
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

    const hintIdx = result.indexOf("Part of speech");
    const reviewIdx = result.indexOf("inaccuracies");
    expect(hintIdx).toBeLessThan(reviewIdx);
    expect(hintIdx).toBeGreaterThan(-1);
  });

  it("renders phrase hint for phrase context", () => {
    const output: TranslateOutput = {
      ...baseOutput,
      dictionaryContext: {
        word: "само собой",
        pos: "phrase",
        glosses: ["it goes without saying"],
        langCode: "ru",
      },
    };

    const result = renderTranslation(output, "en");

    expect(result).toContain("Phrase detected");
    expect(result).toContain("само собой");
    expect(result).toContain("it goes without saying");
  });

  it("renders idiom hint for idiom context", () => {
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

    expect(result).toContain("Idiom detected");
    expect(result).toContain("сорока на хвосте принесла");
  });
});
