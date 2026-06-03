/**
 * Tests for flashcard renderer.
 */
import type { WordDisplayData } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";

// Mock @polyglot/core — keep actual i18n + provide getLangFlag
vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flagMap: Record<string, string> = {
    en: "🇬🇧",
    cs: "🇨🇿",
    de: "🇩🇪",
    ru: "🇷🇺",
  };
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => flagMap[code]),
  };
});

import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardFront,
} from "../renderers/flashcard.renderer.js";

/* ── Test data ─────────────────────────────────────────────────── */

const sampleWord: WordDisplayData = {
  id: 1,
  original: "apple",
  sourceLang: "en",
  inputType: "word",
  emoji: "🍎",
  createdAt: new Date("2025-01-01"),
  translations: {
    ru: {
      text: "яблоко",
      transcription: "ˈjabləkə",
      synonyms: [{ text: "яблочко" }],
      examples: [{ context: "neutral", target: "Я ем яблоко.", native: "I eat an apple." }],
    },
    cs: {
      text: "jablko",
      transcription: "ˈjablkɔ",
    },
  },
};

const wordNoSynonyms: WordDisplayData = {
  id: 2,
  original: "house",
  sourceLang: "en",
  inputType: "word",
  emoji: "🏠",
  createdAt: new Date("2025-01-02"),
  translations: {
    cs: {
      text: "dům",
    },
  },
};

/* ── renderFlashCardFront ──────────────────────────────────────── */

describe("renderFlashCardFront", () => {
  it("contains the original word in bold", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en");
    expect(result).toContain("<b>apple</b>");
  });

  it("contains the progress string", () => {
    const result = renderFlashCardFront(sampleWord, 3, 10, "en");
    expect(result).toContain("3");
    expect(result).toContain("10");
  });

  it("contains emoji", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en");
    expect(result).toContain("🍎");
  });

  it("contains source language flag", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en");
    expect(result).toContain("🇬🇧");
  });

  it("contains input type", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en");
    expect(result).toContain("word");
  });

  it("does NOT contain translation text", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en");
    expect(result).not.toContain("яблоко");
    expect(result).not.toContain("jablko");
  });
});

/* ── renderFlashCardBack ───────────────────────────────────────── */

describe("renderFlashCardBack", () => {
  it("contains the original word", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("<b>apple</b>");
  });

  it("contains all translations", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("<b>яблоко</b>");
    expect(result).toContain("<b>jablko</b>");
  });

  it("contains transcription in brackets", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("[ˈjabləkə]");
    expect(result).toContain("[ˈjablkɔ]");
  });

  it("contains target language flags", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("🇷🇺");
    expect(result).toContain("🇨🇿");
  });

  it("contains synonyms when present", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("яблочко");
  });

  it("contains examples when present", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("💬 <i>Я ем яблоко.</i> (I eat an apple.)");
  });

  it("renders without synonyms when they are absent", () => {
    const result = renderFlashCardBack(wordNoSynonyms, 1, 5, "en");
    expect(result).toContain("<b>dům</b>");
    expect(result).not.toContain("(");
  });

  it("contains progress string", () => {
    const result = renderFlashCardBack(sampleWord, 5, 10, "en");
    expect(result).toContain("5");
    expect(result).toContain("10");
  });
});

/* ── buildFlashCardFrontKeyboard ───────────────────────────────── */

describe("buildFlashCardFrontKeyboard", () => {
  it("has fc:reveal and fc:quit buttons", () => {
    const kb = buildFlashCardFrontKeyboard("en");
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:reveal");
    expect(data).toContain("fc:quit");
  });
});

/* ── buildFlashCardBackKeyboard ────────────────────────────────── */

describe("buildFlashCardBackKeyboard", () => {
  it("has fc:next and fc:quit when not last card", () => {
    const kb = buildFlashCardBackKeyboard(false, "en");
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:next");
    expect(data).toContain("fc:quit");
    expect(data).not.toContain("fc:done");
  });

  it("has fc:done and fc:restart when last card", () => {
    const kb = buildFlashCardBackKeyboard(true, "en");
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:done");
    expect(data).toContain("fc:restart");
    expect(data).not.toContain("fc:next");
  });
});

/* ── buildFlashCardDoneKeyboard ────────────────────────────────── */

describe("buildFlashCardDoneKeyboard", () => {
  it("has fc:restart and fc:close buttons", () => {
    const kb = buildFlashCardDoneKeyboard("en");
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:restart");
    expect(data).toContain("fc:close");
  });
});
