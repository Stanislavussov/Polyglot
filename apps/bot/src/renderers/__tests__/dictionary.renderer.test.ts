/**
 * Tests for dictionary renderer.
 */
import type { VocabularyEntryWithTranslations } from "@polyglot/adapter-db";
import { describe, expect, it, vi } from "vitest";

// Mock @polyglot/core — keep actual i18n + provide getLangFlag
vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flagMap: Record<string, string> = {
    en: "🇬🇧",
    cs: "🇨🇿",
    ru: "🇷🇺",
  };
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => flagMap[code]),
  };
});

import {
  buildDeleteConfirmKeyboard,
  buildDictionaryEntryKeyboard,
  buildDictionaryListKeyboard,
  DICTIONARY_PAGE_SIZE,
  renderDictionaryEntry,
  renderDictionaryList,
} from "../dictionary.renderer.js";

/** Extract callback_data from an inline keyboard button (union type). */
const cbData = (btn: unknown): string | undefined => (btn as { callback_data?: string }).callback_data;

/* ── Test data ─────────────────────────────────────────────────── */

function makeEntry(
  id: number,
  original: string,
  emoji: string,
  translations: Array<{ text: string; targetLangId: number }>,
): VocabularyEntryWithTranslations {
  return {
    id,
    userId: 1,
    original,
    sourceLangId: 1,
    inputType: "word",
    emoji,
    nativeMeaning: null,
    sourceUsage: null,
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    translations: translations.map((t, i) => ({
      id: id * 100 + i,
      entryId: id,
      targetLangId: t.targetLangId,
      text: t.text,
      expressionType: null,
      equivalentNote: null,
      usageNote: null,
      connotationWarning: null,
      details: null,
      srsEaseFactor: 2.5,
      srsInterval: 0,
      srsDueDate: null,
      srsReviewCount: 0,
      isActive: true,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    })),
  };
}

const sampleEntries: VocabularyEntryWithTranslations[] = [
  makeEntry(1, "apple", "🍎", [
    { text: "jablko", targetLangId: 2 },
    { text: "яблоко", targetLangId: 3 },
  ]),
  makeEntry(2, "house", "🏠", [
    { text: "dům", targetLangId: 2 },
    { text: "дом", targetLangId: 3 },
  ]),
  makeEntry(3, "cat", "🐱", [{ text: "kočka", targetLangId: 2 }]),
];

const entryWithDetails: VocabularyEntryWithTranslations = {
  id: 10,
  userId: 1,
  original: "apple",
  sourceLangId: 1,
  inputType: "word",
  emoji: "🍎",
  nativeMeaning: "A fruit.",
  sourceUsage: {
    explanation: "Used for the fruit, not the technology company.",
    synonyms: [{ text: "fruit" }],
    examples: [{ context: "neutral", target: "This apple is sweet.", native: "Это яблоко сладкое." }],
  },
  isActive: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  translations: [
    {
      id: 100,
      entryId: 10,
      targetLangId: 3,
      text: "яблоко",
      expressionType: null,
      equivalentNote: null,
      usageNote: "Нейтральное слово для обозначения фрукта.",
      connotationWarning: null,
      details: {
        synonyms: [{ text: "яблочко" }],
        examples: [{ context: "neutral", target: "Я ем яблоко.", native: "I eat an apple." }],
      },
      srsEaseFactor: 2.5,
      srsInterval: 0,
      srsDueDate: null,
      srsReviewCount: 0,
      isActive: true,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    },
    {
      id: 101,
      entryId: 10,
      targetLangId: 2,
      text: "jablko",
      expressionType: null,
      equivalentNote: null,
      usageNote: null,
      connotationWarning: null,
      details: {
        synonyms: [],
        examples: [],
      },
      srsEaseFactor: 2.5,
      srsInterval: 0,
      srsDueDate: null,
      srsReviewCount: 0,
      isActive: true,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    },
  ],
};

/* ── renderDictionaryList ──────────────────────────────────────── */

describe("renderDictionaryList", () => {
  it("contains header with word count", () => {
    const html = renderDictionaryList(sampleEntries, 1, 1, 3, "en");
    expect(html).toContain("3 words");
  });

  it("each entry shows emoji + original + translation summaries", () => {
    const html = renderDictionaryList(sampleEntries, 1, 1, 3, "en");
    expect(html).toContain("🍎 <b>apple</b>");
    expect(html).toContain("jablko, яблоко");
    expect(html).toContain("🏠 <b>house</b>");
    expect(html).toContain("🐱 <b>cat</b>");
  });

  it("entries with >2 translations show +N suffix", () => {
    const entry = makeEntry(5, "go", "🚶", [
      { text: "jít", targetLangId: 2 },
      { text: "идти", targetLangId: 3 },
      { text: "gehen", targetLangId: 4 },
    ]);
    const html = renderDictionaryList([entry], 1, 1, 1, "en");
    expect(html).toContain("jít, идти, +1");
  });

  it("global indexing — page 2 starts at 16", () => {
    const entry = makeEntry(1, "word", "📝", [{ text: "slovo", targetLangId: 2 }]);
    const html = renderDictionaryList([entry], 2, 3, 45, "en");
    expect(html).toContain("16. ");
    expect(html).not.toContain("1. ");
  });

  it("HTML characters are escaped", () => {
    const entry = makeEntry(1, "A<B>&C", "📝", [{ text: "test", targetLangId: 2 }]);
    const html = renderDictionaryList([entry], 1, 1, 1, "en");
    expect(html).toContain("A&lt;B&gt;&amp;C");
    expect(html).not.toContain("<B>");
  });

  it("no page indicator when single page", () => {
    const html = renderDictionaryList(sampleEntries, 1, 1, 3, "en");
    expect(html).not.toContain("Page");
  });

  it("shows page indicator when multiple pages", () => {
    const html = renderDictionaryList(sampleEntries, 1, 3, 45, "en");
    expect(html).toContain("Page 1 of 3");
  });

  it("handles entries without emoji", () => {
    const entry = makeEntry(1, "hello", "", [{ text: "ahoj", targetLangId: 2 }]);
    const html = renderDictionaryList([entry], 1, 1, 1, "en");
    expect(html).toContain("1. <b>hello</b>");
  });

  it("truncates long words", () => {
    const longWord = "abcdefghijklmnopqrstuvwxyz12345678"; // 34 chars
    const entry = makeEntry(1, longWord, "📝", [{ text: "test", targetLangId: 2 }]);
    const html = renderDictionaryList([entry], 1, 1, 1, "en");
    expect(html).toContain("…");
    expect(html).not.toContain(longWord);
  });
});

/* ── renderDictionaryEntry ─────────────────────────────────────── */

describe("renderDictionaryEntry", () => {
  const langResolver = (id: number) => {
    const map: Record<number, string> = { 1: "en", 2: "cs", 3: "ru" };
    return map[id];
  };

  it("contains original word with emoji", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver);
    expect(html).toContain("🍎 <b>apple</b>");
  });

  it("shows source language flag and input type", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver);
    expect(html).toContain("word · 🇬🇧");
  });

  it("localizes source input type", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver, "ru");
    expect(html).toContain("слово · 🇬🇧");
    expect(html).not.toContain("word · 🇬🇧");
  });

  it("contains translations without transcription", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver);
    expect(html).toContain("🇷🇺 RU: <b>яблоко</b>");
    expect(html).toContain("🇨🇿 CS: <b>jablko</b>");
    expect(html).not.toContain("[");
  });

  it("shows synonyms from details", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver);
    expect(html).toContain("(яблочко)");
  });

  it("shows examples from details", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver);
    expect(html).toContain("💬 <i>Я ем яблоко.</i> (I eat an apple.)");
  });

  it("shows regular usage guidance separately from warnings", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver, "ru");

    expect(html).toContain("💡 Нейтральное слово для обозначения фрукта.");
  });

  it("preserves the full saved source-language learning card", () => {
    const html = renderDictionaryEntry(entryWithDetails, langResolver, "ru");

    expect(html).toContain("Used for the fruit, not the technology company.");
    expect(html).toContain("fruit");
    expect(html).toContain("💬 <i>This apple is sweet.</i> (Это яблоко сладкое.)");
  });

  it("escapes HTML inside saved source usage", () => {
    const html = renderDictionaryEntry(
      {
        ...entryWithDetails,
        sourceUsage: {
          explanation: "Use <carefully> & naturally.",
          synonyms: [{ text: "<fruit>" }],
          examples: [{ context: "neutral", target: "An <apple> & pear.", native: "Яблоко <и> груша." }],
        },
      },
      langResolver,
      "ru",
    );

    expect(html).toContain("Use &lt;carefully&gt; &amp; naturally.");
    expect(html).toContain("&lt;fruit&gt;");
    expect(html).toContain("An &lt;apple&gt; &amp; pear.");
    expect(html).not.toContain("Use <carefully>");
  });

  it("falls back to 🔤 when langResolver returns undefined", () => {
    const noResolver = () => undefined;
    const html = renderDictionaryEntry(entryWithDetails, noResolver);
    expect(html).toContain("🔤");
  });
});

/* ── buildDictionaryListKeyboard ───────────────────────────────── */

describe("buildDictionaryListKeyboard", () => {
  it("has one button per entry with dict:view:{dictionaryId}:{id}:{page} callback", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 1, 1, "en", 7);
    const rows = kb.inline_keyboard;
    // First 3 rows should be entry buttons
    expect(cbData(rows[0]![0])).toBe("dict:view:7:1:1");
    expect(cbData(rows[1]![0])).toBe("dict:view:7:2:1");
    expect(cbData(rows[2]![0])).toBe("dict:view:7:3:1");
  });

  it("has navigation buttons when > 1 page", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 2, 3, "en", 7);
    const rows = kb.inline_keyboard;
    // Navigation row is after the 3 entry rows
    const navRow = rows[3]!;
    expect(navRow.length).toBe(3); // prev, noop, next
    expect(cbData(navRow[0])).toBe("dict:page:7:1");
    expect(cbData(navRow[1])).toBe("dict:noop");
    expect(cbData(navRow[2])).toBe("dict:page:7:3");
  });

  it("no prev button on page 1", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 1, 3, "en", 7);
    const rows = kb.inline_keyboard;
    const navRow = rows[3]!;
    // Should only have noop + next (2 buttons)
    expect(navRow.length).toBe(2);
    expect(cbData(navRow[0])).toBe("dict:noop");
    expect(cbData(navRow[1])).toBe("dict:page:7:2");
  });

  it("no next button on last page", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 3, 3, "en", 7);
    const rows = kb.inline_keyboard;
    const navRow = rows[3]!;
    // Should only have prev + noop (2 buttons)
    expect(navRow.length).toBe(2);
    expect(cbData(navRow[0])).toBe("dict:page:7:2");
    expect(cbData(navRow[1])).toBe("dict:noop");
  });

  it("no navigation row when 1 page", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 1, 1, "en", 7);
    const rows = kb.inline_keyboard;
    // 3 entry rows + switch row + close row = 5 total (no nav row)
    expect(rows.length).toBe(5);
    // Last row is close
    expect(cbData(rows[4]![0])).toBe("dict:close");
  });

  it("has close button", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 1, 1, "en", 7);
    const rows = kb.inline_keyboard;
    const lastRow = rows[rows.length - 1]!;
    expect(cbData(lastRow[0])).toBe("dict:close");
  });

  it("entry buttons show emoji + original", () => {
    const kb = buildDictionaryListKeyboard(sampleEntries, 1, 1, "en", 7);
    const firstBtn = kb.inline_keyboard[0]![0]!;
    expect(firstBtn.text).toBe("🍎 apple");
  });
});

/* ── buildDictionaryEntryKeyboard ──────────────────────────────── */

describe("buildDictionaryEntryKeyboard", () => {
  it("has delete and back buttons", () => {
    const kb = buildDictionaryEntryKeyboard(42, 2, "en", 7);
    const rows = kb.inline_keyboard;
    expect(rows.length).toBe(4);
    expect(cbData(rows[0]![0])).toBe("dict:add-menu:7:42:2");
    expect(cbData(rows[1]![0])).toBe("dict:move-menu:7:42:2");
    expect(cbData(rows[2]![0])).toBe("dict:delete:7:42:2");
    expect(cbData(rows[3]![0])).toBe("dict:page:7:2");
  });

  it("uses i18n for button labels", () => {
    const kb = buildDictionaryEntryKeyboard(1, 1, "en", 7);
    expect(kb.inline_keyboard[2]![0]!.text).toContain("Delete");
    expect(kb.inline_keyboard[3]![0]!.text).toContain("Back");
  });
});

/* ── buildDeleteConfirmKeyboard ────────────────────────────────── */

describe("buildDeleteConfirmKeyboard", () => {
  it("has confirm-delete and cancel buttons", () => {
    const kb = buildDeleteConfirmKeyboard(42, 2, "en", 7);
    const rows = kb.inline_keyboard;
    expect(rows.length).toBe(2);
    expect(cbData(rows[0]![0])).toBe("dict:confirm-delete:7:42:2");
    expect(cbData(rows[1]![0])).toBe("dict:view:7:42:2");
  });

  it("uses i18n for button labels", () => {
    const kb = buildDeleteConfirmKeyboard(1, 1, "en", 7);
    expect(kb.inline_keyboard[0]![0]!.text).toContain("Yes");
    expect(kb.inline_keyboard[1]![0]!.text).toContain("Cancel");
  });
});

/* ── DICTIONARY_PAGE_SIZE ──────────────────────────────────────── */

describe("DICTIONARY_PAGE_SIZE", () => {
  it("is 15", () => {
    expect(DICTIONARY_PAGE_SIZE).toBe(15);
  });
});
