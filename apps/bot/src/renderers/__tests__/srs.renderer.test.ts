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
  it("names the language being recalled and puts the source flag beside the word", () => {
    const html = renderSrsFront(sampleCard, "ru", "en", 2, 20, "ru");

    expect(html).toContain("Повторение 2 из 20");
    expect(html).toContain("<i>→ 🇬🇧 English</i>");
    expect(html).toContain("📝 🇷🇺 <b>Обрисовать проблему</b>");
    // The input-type chrome the translate card never had.
    expect(html).not.toContain("слово ·");
  });

  it("keeps the saved source examples off the front — they carry the answer", () => {
    const html = renderSrsFront(sampleCard, "ru", "en", 2, 20, "ru");

    expect(html).not.toContain("Сначала обрисуем проблему.");
  });
});

describe("renderSrsBack", () => {
  it("puts the recalled answer under the headword, with the source example below it", () => {
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

    expect(html).toContain("🇬🇧 EN: <b>outline the problem</b>");
    expect(html).toContain("💬 <i>Let me outline the problem.</i> (Позвольте обрисовать проблему.)");
    expect(html).toContain("💬 <i>Сначала обрисуем проблему.</i> (First, let us outline the problem.)");
    expect(html).toContain("💡 Употребляется для краткого изложения основных пунктов.");
    expect(html.indexOf("<b>outline the problem</b>")).toBeLessThan(html.indexOf("Сначала обрисуем проблему."));
  });

  it("folds the stored explanation rather than dropping it", () => {
    const html = renderSrsBack(sampleCard, "ru", "en", 2, 20, "ru");

    expect(html).toContain("<blockquote expandable>💡 Кратко представить основные стороны проблемы.</blockquote>");
  });
});

describe("buildSrsDoneKeyboard", () => {
  const rowsOf = (showProgress: boolean): string[][] =>
    buildSrsDoneKeyboard("en", { showProgress }).inline_keyboard.map((row) =>
      row.map((button) => ("callback_data" in button ? button.callback_data : "")),
    );

  it("puts the progress button on a row of its own", () => {
    expect(rowsOf(true)).toEqual([["srs:restart", "srs:close"], ["progress:open:srs_done"]]);
  });

  it("omits the progress button while the motivation surface is off", () => {
    expect(rowsOf(false)).toEqual([["srs:restart", "srs:close"]]);
  });
});
