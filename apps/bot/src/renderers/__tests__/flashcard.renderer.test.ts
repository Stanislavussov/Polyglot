/**
 * Cards renderer — the deck's chrome around a card, and the buttons under it.
 */
import type { CardsDeckCard, VocabularyEntryWithTranslations } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flagMap: Record<string, string> = { en: "🇬🇧", ru: "🇷🇺" };
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => flagMap[code]),
  };
});

import { createLanguageOrderContext } from "@polyglot/core";
import { getCallbackDataByteLength, MAX_TELEGRAM_CALLBACK_DATA_BYTES } from "../../callbacks/contracts.js";
import { renderDictionaryEntry } from "../dictionary.renderer.js";
import {
  buildFlashCardBackKeyboard,
  buildFlashCardDoneKeyboard,
  buildFlashCardFrontKeyboard,
  renderFlashCardBack,
  renderFlashCardBackFromCard,
  renderFlashCardDone,
  renderFlashCardFront,
} from "../flashcard.renderer.js";

const CARD: CardsDeckCard = {
  translationId: 10,
  entryId: 1,
  original: "Обрисовать проблему",
  sourceLangId: 2,
  targetLangId: 1,
  inputType: "word",
  emoji: "📝",
  nativeMeaning: "Кратко изложить суть.",
  sourceUsage: {
    explanation: "Кратко представить основные стороны проблемы.",
    synonyms: [{ text: "кратко описать" }],
    examples: [
      { context: "neutral", target: "Сначала обрисуем проблему.", native: "First, let us outline the problem." },
    ],
    recallHint: "Деловой регистр.",
  },
  text: "outline the problem",
  expressionType: null,
  equivalentNote: null,
  usageNote: "Употребляется для краткого изложения основных пунктов.",
  connotationWarning: null,
  details: {
    synonyms: [],
    examples: [{ context: "neutral", target: "Let me outline the problem.", native: "Позвольте обрисовать проблему." }],
  },
  difficulty: null,
  srsEaseFactor: 2.5,
  srsInterval: 0,
  srsReviewCount: 0,
  ahead: false,
};

/** The saved word the card above is one row of — Russian source, saved in English and Czech. */
const ENTRY: VocabularyEntryWithTranslations = {
  id: 1,
  userId: 7,
  original: CARD.original,
  sourceLangId: 2,
  inputType: "word",
  emoji: CARD.emoji,
  nativeMeaning: CARD.nativeMeaning,
  sourceUsage: CARD.sourceUsage,
  source: null,
  unverified: false,
  difficulty: null,
  isActive: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  translations: [
    {
      id: 10,
      entryId: 1,
      targetLangId: 1,
      text: CARD.text,
      expressionType: null,
      equivalentNote: null,
      usageNote: CARD.usageNote,
      connotationWarning: null,
      details: CARD.details ?? null,
      srsEaseFactor: 2.5,
      srsInterval: 0,
      srsDueDate: null,
      srsReviewCount: 0,
      isActive: true,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
  ],
};

const RESOLVE_CODE = (id: number): string | undefined => ({ 1: "en", 2: "ru" })[id];
const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["en"] });

const ALL_ON = { synonyms: true, example: true, hint: true };
const ALL_OFF = { synonyms: false, example: false, hint: false };

const callbacksOf = (kb: { inline_keyboard: Array<Array<{ callback_data?: string } | object>> }): string[][] =>
  kb.inline_keyboard.map((row) => row.map((button) => ("callback_data" in button ? String(button.callback_data) : "")));

describe("renderFlashCardFront", () => {
  it("shows the progress and puts the source label beside the word", () => {
    const html = renderFlashCardFront(CARD, "ru", 2, 10, "ru", ALL_OFF);

    expect(html).toContain("Карточка 2 из 10");
    expect(html).toContain("📝 🇷🇺 RU: <b>Обрисовать проблему</b>");
  });

  it("does not name a recall direction — the answer is every language the word is saved in", () => {
    expect(renderFlashCardFront(CARD, "ru", 2, 10, "ru", ALL_OFF)).not.toMatch(/<i>→/u);
  });

  it("hands over nothing of the answer, whatever the user switched on", () => {
    const html = renderFlashCardFront(CARD, "ru", 1, 1, "ru", ALL_ON);

    expect(html).toContain("Деловой регистр.");
    for (const answer of ["outline the problem", CARD.nativeMeaning!, "First, let us outline the problem."]) {
      expect(html).not.toContain(answer);
    }
  });

  it("tells a practice-ahead card apart with a one-line note", () => {
    const note = "Повторение заранее";

    expect(renderFlashCardFront({ ...CARD, ahead: true }, "ru", 1, 1, "ru", ALL_OFF)).toContain(note);
    expect(renderFlashCardFront(CARD, "ru", 1, 1, "ru", ALL_OFF)).not.toContain(note);
  });
});

describe("renderFlashCardBack", () => {
  it("shows the saved word exactly as the dictionary shows it, under the deck's chrome", () => {
    const html = renderFlashCardBack(ENTRY, RESOLVE_CODE, 2, 10, "ru", ORDER);

    expect(html).toContain(renderDictionaryEntry(ENTRY, RESOLVE_CODE, "ru", ORDER));
    expect(html).toContain("Карточка 2 из 10");
    expect(html).not.toMatch(/<i>→/u);
    expect(html.endsWith("Насколько хорошо вы это вспомнили?")).toBe(true);
  });

  it("keeps the answer and its example on the card", () => {
    const html = renderFlashCardBack(ENTRY, RESOLVE_CODE, 2, 10, "ru", ORDER);

    expect(html).toContain("🇬🇧 EN: <b>outline the problem</b>");
    expect(html).toContain("💬 <i>Let me outline the problem.</i> (Позвольте обрисовать проблему.)");
  });
});

describe("renderFlashCardBackFromCard", () => {
  it("answers from the deck card alone when the entry is gone", () => {
    const html = renderFlashCardBackFromCard(CARD, "ru", "en", 2, 10, "ru");

    expect(html).toContain("Карточка 2 из 10");
    expect(html).toContain("🇬🇧 EN: <b>outline the problem</b>");
    expect(html).not.toMatch(/<i>→/u);
  });
});

describe("renderFlashCardDone", () => {
  it("reports the cards reviewed and how many were recalled, as label: number", () => {
    expect(renderFlashCardDone("en", { cards: 7, recalled: 5 })).toBe("🎉 Done — cards: 7 · recalled: 5");
  });
});

describe("card keyboards", () => {
  it("front offers reveal, quit and removing the word", () => {
    expect(callbacksOf(buildFlashCardFrontKeyboard("en", 1))).toEqual([["fc:reveal", "fc:quit"], ["fc:del:1"]]);
  });

  it("back offers the four ratings addressed to this translation, removal and quit", () => {
    expect(callbacksOf(buildFlashCardBackKeyboard("en", { translationId: 10, entryId: 1 }))).toEqual([
      ["fc:rate:again:10", "fc:rate:hard:10"],
      ["fc:rate:good:10", "fc:rate:easy:10"],
      ["fc:del:1"],
      ["fc:quit"],
    ]);
  });

  it("back puts the ordinary card's actions under the ratings, above removal and quit", () => {
    const actions = [[{ text: "⋯", callback_data: "tr:more:5" }], [{ text: "Save", callback_data: "tr:save:5" }]];

    expect(callbacksOf(buildFlashCardBackKeyboard("en", { translationId: 10, entryId: 1 }, actions))).toEqual([
      ["fc:rate:again:10", "fc:rate:hard:10"],
      ["fc:rate:good:10", "fc:rate:easy:10"],
      ["tr:more:5"],
      ["tr:save:5"],
      ["fc:del:1"],
      ["fc:quit"],
    ]);
  });

  it("keeps the largest rating and removal data inside Telegram's 64-byte limit", () => {
    const max = 2_147_483_647;
    for (const row of callbacksOf(buildFlashCardBackKeyboard("en", { translationId: max, entryId: max }))) {
      for (const data of row)
        expect(getCallbackDataByteLength(data)).toBeLessThanOrEqual(MAX_TELEGRAM_CALLBACK_DATA_BYTES);
    }
  });

  it("finish screen puts the progress button on a row of its own", () => {
    expect(callbacksOf(buildFlashCardDoneKeyboard("en", { showProgress: true }))).toEqual([
      ["fc:restart", "fc:close"],
      ["progress:open:flashcard_done"],
    ]);
  });

  it("finish screen omits the progress button while the motivation surface is off", () => {
    expect(callbacksOf(buildFlashCardDoneKeyboard("en", { showProgress: false }))).toEqual([
      ["fc:restart", "fc:close"],
    ]);
  });
});
