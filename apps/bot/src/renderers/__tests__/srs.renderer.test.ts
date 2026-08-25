import type { SrsDueVocabularyCard } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flagMap: Record<string, string> = {
    en: "🇬🇧",
    ru: "🇷🇺",
  };
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => flagMap[code]),
    getLanguageName: vi.fn((code: string) => (code === "en" ? "English" : code)),
  };
});

import { buildSrsDoneKeyboard, renderSrsBack, renderSrsFront } from "../srs.renderer.js";

const sampleCard: SrsDueVocabularyCard = {
  translationId: 10,
  entryId: 1,
  original: "Обрисовать проблему",
  sourceLangId: 2,
  targetLangId: 1,
  inputType: "word",
  emoji: "📝",
  nativeMeaning: null,
  sourceUsage: {
    explanation: "Кратко представить основные стороны проблемы.",
    synonyms: [{ text: "кратко описать" }],
    examples: [
      { context: "neutral", target: "Сначала обрисуем проблему.", native: "First, let us outline the problem." },
    ],
  },
  text: "outline the problem",
  expressionType: null,
  equivalentNote: null,
  usageNote: "Употребляется для краткого изложения основных пунктов.",
  connotationWarning: null,
  details: null,
  difficulty: null,
  srsEaseFactor: 2.5,
  srsInterval: 0,
  srsDueDate: null,
  srsReviewCount: 0,
};

describe("renderSrsFront", () => {
  it("localizes the input type label in the review direction line", () => {
    const html = renderSrsFront(sampleCard, "ru", "en", 2, 20, "ru");

    expect(html).toContain("Повторение 2 из 20");
    expect(html).toContain("<b>Обрисовать проблему</b>");
    expect(html).toContain("слово · 🇷🇺 → 🇬🇧 English");
    expect(html).not.toContain("word · 🇷🇺 → 🇬🇧 English");
  });
});

describe("renderSrsBack", () => {
  it("shows a compact source example before the target example", () => {
    const card = {
      ...sampleCard,
      details: {
        synonyms: [],
        examples: [
          { context: "neutral", target: "Let me outline the problem.", native: "Позвольте обрисовать проблему." },
        ],
      },
    };

    const html = renderSrsBack(card, "ru", "en", 2, 20, "ru");

    expect(html).toContain("Сначала обрисуем проблему.");
    expect(html).toContain("First, let us outline the problem.");
    expect(html).toContain("Let me outline the problem.");
    expect(html).toContain("💡 Употребляется для краткого изложения основных пунктов.");
  });
});

describe("buildSrsDoneKeyboard", () => {
  it("puts the progress button on a row of its own", () => {
    const rows = buildSrsDoneKeyboard("en").inline_keyboard.map((row) =>
      row.map((button) => ("callback_data" in button ? button.callback_data : "")),
    );

    expect(rows).toEqual([["srs:restart", "srs:close"], ["progress:open:srs_done"]]);
  });
});
