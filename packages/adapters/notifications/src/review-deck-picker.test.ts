import type { SrsDueVocabularyCard } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { createReviewDeckPicker } from "./review-deck-picker.js";

function row(entryId: number, original: string, overrides: Partial<SrsDueVocabularyCard> = {}): SrsDueVocabularyCard {
  return {
    translationId: entryId * 10,
    entryId,
    original,
    sourceLangId: 1,
    targetLangId: 2,
    inputType: "word",
    emoji: null,
    nativeMeaning: null,
    sourceUsage: null,
    text: `${original}-tr`,
    expressionType: null,
    equivalentNote: null,
    usageNote: null,
    connotationWarning: null,
    details: null,
    difficulty: null,
    srsEaseFactor: 2.5,
    srsInterval: 1,
    srsDueDate: null,
    srsReviewCount: 0,
    ...overrides,
  };
}

function picker(due: SrsDueVocabularyCard[], ahead: SrsDueVocabularyCard[] = []) {
  const deps = {
    findDueForSrs: vi.fn().mockResolvedValue(due),
    findAheadForSrs: vi.fn().mockResolvedValue(ahead),
  };
  return { deps, pick: createReviewDeckPicker(deps) };
}

describe("review deck picker", () => {
  it("offers due words first and tops the deck up with words not due yet", async () => {
    const { pick } = picker([row(1, "pes")], [row(2, "kočka"), row(3, "dům")]);

    const deck = await pick(7, 3, []);

    expect(deck.map((card) => [card.original, card.ahead])).toEqual([
      ["pes", false],
      ["kočka", true],
      ["dům", true],
    ]);
  });

  it("stops at the size the user asked for", async () => {
    const { deps, pick } = picker([row(1, "pes"), row(2, "kočka"), row(3, "dům")]);

    const deck = await pick(7, 2, []);

    expect(deck).toHaveLength(2);
    expect(deps.findAheadForSrs).not.toHaveBeenCalled();
  });

  it("never opens on a word a recent notification already carried", async () => {
    const { pick } = picker([row(1, "pes"), row(2, "kočka")], [row(3, "dům")]);

    const deck = await pick(7, 3, ["pes"]);

    expect(deck.map((card) => card.original)).toEqual(["kočka", "dům"]);
  });

  it("puts one card per word in the deck even when it is due in two languages", async () => {
    const { pick } = picker([row(1, "pes"), row(1, "pes", { translationId: 11, targetLangId: 3 }), row(2, "kočka")]);

    const deck = await pick(7, 3, []);

    expect(deck.map((card) => card.entryId)).toEqual([1, 2]);
  });

  it("returns an empty deck when there is nothing left to review", async () => {
    const { pick } = picker([row(1, "pes")]);

    expect(await pick(7, 3, ["pes"])).toEqual([]);
  });

  it("keeps widening the search when one word's language rows fill the first page", async () => {
    // Four languages per word, two words recently sent: the first page (2 × 4 + 2 = 10 rows)
    // is almost all theirs and holds one fresh word.
    const rowsOf = (entryId: number, original: string) =>
      [1, 2, 3, 4].map((lang) => row(entryId, original, { translationId: entryId * 10 + lang, targetLangId: lang }));
    const all = [...rowsOf(1, "pes"), ...rowsOf(2, "kočka"), ...rowsOf(3, "dům"), ...rowsOf(4, "strom")];
    const findDueForSrs = vi.fn(async (_userId: number, _now: Date, limit: number) => all.slice(0, limit));
    const pick = createReviewDeckPicker({ findDueForSrs, findAheadForSrs: vi.fn().mockResolvedValue([]) });

    const deck = await pick(7, 2, ["pes", "kočka"]);

    expect(deck.map((card) => card.original)).toEqual(["dům", "strom"]);
    expect(findDueForSrs.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not count a word already in the deck when topping up with words not due yet", async () => {
    // "pes" is due in one language and ahead in seven others; those rows fill the first
    // ahead page, and counting "pes" again would stop the search before "dům".
    const aheadRows = [
      ...[2, 3, 4, 5, 6, 7, 8].map((lang) => row(1, "pes", { translationId: 10 + lang, targetLangId: lang })),
      row(2, "kočka"),
      row(3, "dům"),
    ];
    const findAheadForSrs = vi.fn(async (_userId: number, _now: Date, limit: number) => aheadRows.slice(0, limit));
    const pick = createReviewDeckPicker({ findDueForSrs: vi.fn().mockResolvedValue([row(1, "pes")]), findAheadForSrs });

    const deck = await pick(7, 3, []);

    expect(deck.map((card) => card.original)).toEqual(["pes", "kočka", "dům"]);
  });
});
