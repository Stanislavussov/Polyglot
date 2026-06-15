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

import { renderSrsFront } from "../srs.renderer.js";

const sampleCard: SrsDueVocabularyCard = {
  translationId: 10,
  entryId: 1,
  original: "Обрисовать проблему",
  sourceLangId: 2,
  targetLangId: 1,
  inputType: "word",
  emoji: "📝",
  nativeMeaning: null,
  text: "outline the problem",
  expressionType: null,
  equivalentNote: null,
  connotationWarning: null,
  details: null,
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
