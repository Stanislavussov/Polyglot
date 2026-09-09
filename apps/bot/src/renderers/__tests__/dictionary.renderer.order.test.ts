/**
 * Language ordering on the dictionary surfaces.
 *
 * The regression these guard: the entry card sorted only the native language to
 * the front and returned 0 for every other pair, so — `Array.prototype.sort`
 * being stable — the learning languages appeared in whatever order the rows
 * arrived in. Rows arrive in an order that shifts whenever a translation row is
 * rewritten, which happens on every SRS review.
 *
 * The fixture is deliberately chosen so the user's order (ru, de, es, cs) differs
 * from the alphabetical order (cs, de, es, ru) at every position: any assertion
 * below fails both against the old behaviour and against an empty ordering
 * context.
 */
import type { VocabularyEntryWithTranslations, VocabularyTranslation } from "@polyglot/adapter-db";
import { createLanguageOrderContext } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { renderDictionaryEntry, renderDictionaryList } from "../dictionary.renderer.js";

const LANG_BY_ID: Record<number, string> = { 1: "ru", 2: "de", 3: "es", 4: "cs" };
const resolveCode = (id: number): string | undefined => LANG_BY_ID[id];

const ORDER = createLanguageOrderContext({ nativeLang: "ru", learningLangs: ["de", "es", "cs"] });
const USER_ORDER = ["RU", "DE", "ES", "CS"];

function translation(targetLangId: number, text: string): VocabularyTranslation {
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
  };
}

function entry(translations: VocabularyTranslation[]): VocabularyEntryWithTranslations {
  return {
    id: 10,
    userId: 1,
    original: "house",
    sourceLangId: 9,
    inputType: "word",
    emoji: "🏠",
    nativeMeaning: null,
    sourceUsage: null,
    source: null,
    unverified: false,
    difficulty: null,
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    translations,
  };
}

/** Alphabetical by code — what an unordered read and a jsonb round-trip both produce. */
const ALPHABETICAL = [translation(4, "dům"), translation(2, "Haus"), translation(3, "casa"), translation(1, "дом")];

/** Positions of each language's block, in render order. */
function renderedLanguageOrder(html: string): string[] {
  return [...html.matchAll(/\b(RU|DE|ES|CS):/g)].map((m) => m[1] as string);
}

describe("renderDictionaryEntry — language order", () => {
  it("renders native first, then learning languages in the user's own order", () => {
    const html = renderDictionaryEntry(entry(ALPHABETICAL), resolveCode, "en", ORDER);
    expect(renderedLanguageOrder(html)).toEqual(USER_ORDER);
  });

  it("produces the same order no matter what order the rows arrive in", () => {
    // Row order is plan-dependent and moves after any UPDATE; the rendered card
    // must not inherit that.
    const permutations = [
      ALPHABETICAL,
      [...ALPHABETICAL].reverse(),
      [translation(3, "casa"), translation(1, "дом"), translation(4, "dům"), translation(2, "Haus")],
    ];
    for (const rows of permutations) {
      expect(renderedLanguageOrder(renderDictionaryEntry(entry(rows), resolveCode, "en", ORDER))).toEqual(USER_ORDER);
    }
  });

  it("renders a language the user no longer studies last, without dropping it", () => {
    const withDropped = [...ALPHABETICAL, translation(7, "maison")];
    const html = renderDictionaryEntry(entry(withDropped), resolveCode, "en", ORDER);

    expect(html).toContain("maison");
    expect(renderedLanguageOrder(html)).toEqual(USER_ORDER);
  });
});

describe("renderDictionaryList — preview order", () => {
  it("previews the first two languages in the user's order, not alphabetically", () => {
    // The list shows only two translations, so ordering decides *which* the user
    // sees at all — not merely the sequence.
    const html = renderDictionaryList([entry(ALPHABETICAL)], 1, 1, 1, "en", resolveCode, ORDER);

    expect(html).toContain("дом, Haus, +2");
  });

  it("picks the same two languages regardless of row order", () => {
    const reversed = renderDictionaryList([entry([...ALPHABETICAL].reverse())], 1, 1, 1, "en", resolveCode, ORDER);

    expect(reversed).toContain("дом, Haus, +2");
  });
});
