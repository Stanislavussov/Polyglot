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
});
