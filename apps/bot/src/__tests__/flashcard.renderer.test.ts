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

import { type CardFrontFields, createLanguageOrderContext, type SupportedLang } from "@polyglot/core";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack as renderFlashCardBackRaw,
  renderFlashCardFront,
} from "../renderers/flashcard.renderer.js";

/** These cases assert card content, not language sequence. */
const NO_ORDER = createLanguageOrderContext({ learningLangs: [] });
const renderFlashCardBack = (
  word: WordDisplayData,
  cardIndex: number,
  totalCards: number,
  lang: SupportedLang,
): string => renderFlashCardBackRaw(word, cardIndex, totalCards, lang, NO_ORDER);

/* ── Test data ─────────────────────────────────────────────────── */

/** Every front option on: whatever still stays off the front is off it for every user. */
const ALL_ON: CardFrontFields = { synonyms: true, example: true, hint: true };
const ALL_OFF: CardFrontFields = { synonyms: false, example: false, hint: false };

const sampleWord: WordDisplayData = {
  id: 1,
  original: "apple",
  nativeMeaning: "A round fruit.",
  sourceUsage: {
    explanation: "Used for the fruit, not the technology company.",
    synonyms: [{ text: "fruit" }],
    examples: [{ context: "neutral", target: "This apple is sweet.", native: "Это яблоко сладкое." }],
    recallHint: "Everyday word, often about food.",
  },
  sourceLang: "en",
  inputType: "word",
  emoji: "🍎",
  createdAt: new Date("2025-01-01"),
  translations: {
    ru: {
      text: "яблоко",
      usageNote: "Нейтральное общеупотребительное слово.",
      synonyms: [{ text: "яблочко" }],
      examples: [{ context: "neutral", target: "Я ем яблоко.", native: "I eat an apple." }],
    },
    cs: {
      text: "jablko",
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
    const result = renderFlashCardFront(sampleWord, 1, 10, "en", ALL_ON);
    expect(result).toContain("<b>apple</b>");
  });

  it("never shows the stored meaning or explanation — they are the answer in the reader's language", () => {
    const result = renderFlashCardFront(sampleWord, 1, 5, "en", ALL_ON);
    expect(result).not.toContain("A round fruit.");
    expect(result).not.toContain("Used for the fruit, not the technology company.");
  });

  it("shows the recall hint, a bare source example and synonyms when the user switched them on", () => {
    const result = renderFlashCardFront(sampleWord, 1, 5, "en", ALL_ON);
    expect(result).toContain("🍎 🇬🇧 <b>apple</b> (fruit)");
    expect(result).toContain("🔎 <i>Everyday word, often about food.</i>");
    expect(result).toContain("💬 <i>This apple is sweet.</i>");
  });

  it("shows only the word when every front option is off", () => {
    const result = renderFlashCardFront(sampleWord, 1, 5, "en", ALL_OFF);
    expect(result).toContain("🍎 🇬🇧 <b>apple</b>");
    expect(result).not.toContain("(fruit)");
    expect(result).not.toContain("🔎");
    expect(result).not.toContain("This apple is sweet.");
  });

  it("omits the hint line for a word saved before hints existed", () => {
    const legacy: WordDisplayData = {
      ...sampleWord,
      sourceUsage: { ...sampleWord.sourceUsage!, recallHint: undefined },
    };
    expect(renderFlashCardFront(legacy, 1, 5, "en", ALL_ON)).not.toContain("🔎");
  });

  it("contains the progress string", () => {
    const result = renderFlashCardFront(sampleWord, 3, 10, "en", ALL_ON);
    expect(result).toContain("3");
    expect(result).toContain("10");
  });

  it("contains emoji", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en", ALL_ON);
    expect(result).toContain("🍎");
  });

  it("contains the source language flag beside the word", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en", ALL_ON);
    expect(result).toContain("🍎 🇬🇧 <b>apple</b>");
  });

  it("carries no input-type chrome line — the translate card has none", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "ru", ALL_ON);
    expect(result).not.toContain("слово ·");
    expect(result).not.toContain("word ·");
  });

  it("keeps a source example's native gloss off the front — it is the translation", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en", ALL_ON);
    expect(result).not.toContain("Это яблоко сладкое.");
  });

  it("does NOT contain translation text", () => {
    const result = renderFlashCardFront(sampleWord, 1, 10, "en", ALL_ON);
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

  it("renders translation text without transcription", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "en");
    expect(result).toContain("<b>яблоко</b>");
    expect(result).toContain("<b>jablko</b>");
    expect(result).not.toContain("[");
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

  it("shows saved source-language usage guidance", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "ru");

    expect(result).toContain("Used for the fruit, not the technology company.");
    expect(result).toContain("fruit");
    expect(result).toContain("💬 <i>This apple is sweet.</i> (Это яблоко сладкое.)");
  });

  it("shows regular target usage guidance separately", () => {
    const result = renderFlashCardBack(sampleWord, 1, 10, "ru");

    expect(result).toContain("💡 Нейтральное общеупотребительное слово.");
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

const callbacksOf = (kb: { inline_keyboard: Array<Array<object>> }): string[][] =>
  kb.inline_keyboard.map((row) => row.map((button) => ("callback_data" in button ? String(button.callback_data) : "")));

describe("buildFlashCardFrontKeyboard", () => {
  it("offers reveal, quit, and removing this word from the dictionary", () => {
    expect(callbacksOf(buildFlashCardFrontKeyboard("en", 7))).toEqual([["fc:reveal", "fc:quit"], ["fc:del:7"]]);
  });
});

/* ── buildFlashCardBackKeyboard ────────────────────────────────── */

describe("buildFlashCardBackKeyboard", () => {
  it("offers the notification grades and removal for the revealed word", () => {
    const rows = callbacksOf(buildFlashCardBackKeyboard(false, "en", 7));
    expect(rows[0]).toEqual(["fc:fb:hard:7", "fc:fb:normal:7", "fc:fb:easy:7"]);
    expect(rows[1]).toEqual(["fc:del:7"]);
  });

  it("labels the grades exactly as the notification does", () => {
    const labels = buildFlashCardBackKeyboard(false, "ru", 7).inline_keyboard[0]?.map((button) => button.text);
    expect(labels).toEqual(["😅 Трудно", "👌 ОК", "😎 Знаю"]);
  });

  it("has fc:next and fc:quit when not last card", () => {
    const kb = buildFlashCardBackKeyboard(false, "en", 7);
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:next");
    expect(data).toContain("fc:quit");
    expect(data).not.toContain("fc:done");
  });

  it("has fc:done and fc:restart when last card", () => {
    const kb = buildFlashCardBackKeyboard(true, "en", 7);
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:done");
    expect(data).toContain("fc:restart");
    expect(data).not.toContain("fc:next");
  });
});

/* ── buildFlashCardDoneKeyboard ────────────────────────────────── */

describe("buildFlashCardDoneKeyboard", () => {
  it("has fc:restart and fc:close buttons", () => {
    const kb = buildFlashCardDoneKeyboard("en", { showProgress: false });
    const data = JSON.stringify(kb);
    expect(data).toContain("fc:restart");
    expect(data).toContain("fc:close");
  });
});
