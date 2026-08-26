/**
 * One stored word, four surfaces, one grammar.
 *
 * The contract under test is not any single renderer's output — it is the
 * relation between them, which is what the user actually reported: the same word
 * looked like a different product depending on where it resurfaced. Each surface
 * has its own input type (`VocabularyEntryWithTranslations`, `WordDisplayData`,
 * `SrsDueVocabularyCard`), so nothing but a test holds them to the same shape;
 * a per-renderer suite can be entirely green while the four disagree.
 *
 * One object mother describes the word; each surface's fixture is a projection of
 * it, so an assertion below cannot pass by comparing two copies of the same
 * accidental formatting.
 */
import type { VocabularyEntryWithTranslations, VocabularyTranslation } from "@polyglot/adapter-db";
import { describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flags: Record<string, string> = { de: "🇩🇪", en: "🇬🇧", ru: "🇷🇺" };
  return {
    ...actual,
    getLangFlag: (code: string) => flags[code],
    getLanguageName: (code: string) => (code === "en" ? "English" : code),
  };
});

import type { SrsDueVocabularyCard, WordDisplayData } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { renderDictionaryEntry } from "../dictionary.renderer.js";
import { renderFlashCardBack, renderFlashCardFront } from "../flashcard.renderer.js";
import { renderSrsBack, renderSrsFront } from "../srs.renderer.js";

/** The word every fixture below is a projection of. */
const WORD = {
  original: "arbeit",
  emoji: "💼",
  nativeMeaning: "Занятие за плату.",
  sourceLang: "de",
  targetLang: "en",
  targetText: "work",
  targetSynonym: "job",
  targetExample: { context: "neutral", target: "Hard work.", native: "Тяжёлая работа." },
  usageNote: "Общее слово.",
  sourceUsage: {
    headword: "die Arbeit",
    explanation: "Работа, труд.",
    synonyms: [{ text: "die Tätigkeit" }],
    examples: [{ context: "daily", target: "Die Arbeit macht Spaß.", native: "Работа в радость." }],
  },
};

/** A ru-native user learning German and English — the reverse-learning direction. */
const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "en"] });
const LANG_ID = { ru: 1, de: 2, en: 3 } as const;
const resolveCode = (id: number): string | undefined =>
  ({ [LANG_ID.ru]: "ru", [LANG_ID.de]: "de", [LANG_ID.en]: "en" })[id];

function translationRow(targetLangId: number, text: string, over: Partial<VocabularyTranslation> = {}) {
  return {
    id: 100 + targetLangId,
    entryId: 10,
    targetLangId,
    text,
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
    ...over,
  } satisfies VocabularyTranslation;
}

const DICTIONARY_ENTRY: VocabularyEntryWithTranslations = {
  id: 10,
  userId: 1,
  original: WORD.original,
  sourceLangId: LANG_ID.de,
  inputType: "word",
  emoji: WORD.emoji,
  nativeMeaning: WORD.nativeMeaning,
  sourceUsage: WORD.sourceUsage,
  source: null,
  unverified: false,
  difficulty: null,
  isActive: true,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  translations: [
    translationRow(LANG_ID.en, WORD.targetText, {
      usageNote: WORD.usageNote,
      details: { synonyms: [{ text: WORD.targetSynonym }], examples: [WORD.targetExample] },
    }),
    translationRow(LANG_ID.ru, "работа"),
  ],
};

const FLASHCARD_WORD: WordDisplayData = {
  id: 10,
  original: WORD.original,
  nativeMeaning: WORD.nativeMeaning,
  sourceUsage: WORD.sourceUsage,
  sourceLang: WORD.sourceLang,
  inputType: "word",
  emoji: WORD.emoji,
  createdAt: new Date("2025-01-01"),
  translations: {
    en: {
      text: WORD.targetText,
      synonyms: [{ text: WORD.targetSynonym }],
      examples: [WORD.targetExample],
      usageNote: WORD.usageNote,
    },
    ru: { text: "работа" },
  },
};

const SRS_CARD: SrsDueVocabularyCard = {
  translationId: 103,
  entryId: 10,
  original: WORD.original,
  sourceLangId: LANG_ID.de,
  targetLangId: LANG_ID.en,
  inputType: "word",
  emoji: WORD.emoji,
  nativeMeaning: WORD.nativeMeaning,
  sourceUsage: WORD.sourceUsage,
  text: WORD.targetText,
  expressionType: null,
  equivalentNote: null,
  usageNote: WORD.usageNote,
  connotationWarning: null,
  details: { synonyms: [{ text: WORD.targetSynonym }], examples: [WORD.targetExample] },
  difficulty: null,
  srsEaseFactor: 2.5,
  srsInterval: 0,
  srsDueDate: null,
  srsReviewCount: 0,
};

/**
 * Every card a saved word can be shown on: the surface's name, its rendering, and
 * the answer that surface promotes under the headword — the reader's own language
 * where the whole word is shown, the recalled language on an SRS review.
 */
const SURFACES: Array<[string, string, string]> = [
  ["dictionary entry", renderDictionaryEntry(DICTIONARY_ENTRY, resolveCode, "ru", ORDER), "работа"],
  ["flashcard back", renderFlashCardBack(FLASHCARD_WORD, 1, 3, "ru", ORDER), "работа"],
  ["srs back", renderSrsBack(SRS_CARD, "de", "en", 1, 3, "ru"), WORD.targetText],
];

/** The line naming the word — located by content, since chrome sits above some cards. */
function headwordLine(card: string): string {
  const line = card.split("\n").find((candidate) => candidate.includes("<b>die Arbeit</b>"));
  if (line === undefined) throw new Error(`no headword line in:\n${card}`);
  return line;
}

function targetAnswerLine(card: string): string {
  const line = card.split("\n").find((candidate) => candidate.includes(`<b>${WORD.targetText}</b>`));
  if (line === undefined) throw new Error(`no answer line in:\n${card}`);
  return line;
}

describe("card grammar — every surface renders a saved word the same way", () => {
  it.each(SURFACES)("%s puts emoji, source flag, headword and source synonyms on one line", (_name, card) => {
    expect(headwordLine(card)).toBe("💼 🇩🇪 <b>die Arbeit</b> (die Tätigkeit)");
  });

  it.each(SURFACES)("%s renders the answer as flag, code, bold text and inline synonyms", (_name, card) => {
    expect(targetAnswerLine(card)).toBe("🇬🇧 EN: <b>work</b> (job)");
  });

  it.each(SURFACES)("%s keeps the example visible and folds the usage note", (_name, card) => {
    expect(card).toContain("💬 <i>Hard work.</i> (Тяжёлая работа.)");
    expect(card).toContain("<blockquote expandable>💡 Общее слово.</blockquote>");
  });

  it.each(SURFACES)("%s carries no input-type chrome line", (_name, card) => {
    expect(card).not.toMatch(/<i>[^<]*·/);
  });

  it.each(SURFACES)("%s folds the stored prose below the promoted answer", (_name, card, promoted) => {
    expect(card).toContain("💡 Занятие за плату.");
    // Never a bare visible line of its own — that layout is what put the reader's
    // own language below two lines of description in the first place.
    expect(card).not.toMatch(/^Занятие за плату\.$/m);
    expect(card.indexOf(`<b>${promoted}</b>`)).toBeLessThan(card.indexOf("Занятие за плату."));
  });
});

describe("card grammar — a reveal-style front hands over nothing", () => {
  it.each([
    ["flashcard front", renderFlashCardFront(FLASHCARD_WORD, 1, 3, "ru")],
    ["srs front", renderSrsFront(SRS_CARD, "de", "en", 1, 3, "ru")],
  ])("%s shows the word but neither the answer nor a glossed source example", (_name, front) => {
    expect(front).toContain("💼 🇩🇪 <b>die Arbeit</b>");
    expect(front).not.toContain(WORD.targetText);
    // The source example's native gloss is the answer in the reader's own language.
    expect(front).not.toContain("Работа в радость.");
  });

  it("srs front names the language being recalled — the one line it cannot lose", () => {
    expect(renderSrsFront(SRS_CARD, "de", "en", 1, 3, "ru")).toContain("<i>→ 🇬🇧 English</i>");
  });
});
