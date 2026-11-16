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

    expect(deck[0]).toMatchObject({ original: "pes", ahead: false });
    expect(
      deck
        .slice(1)
        .map((card) => [card.original, card.ahead])
        .sort(),
    ).toEqual([
      ["dům", true],
      ["kočka", true],
    ]);
  });

  it("stops at the size the user asked for", async () => {
    const { pick } = picker([row(1, "pes"), row(2, "kočka"), row(3, "dům")], [row(4, "strom")]);

    const deck = await pick(7, 2, []);

    expect(deck.map((card) => card.original)).toEqual(["pes", "kočka"]);
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

  it("puts words not sent lately before words already sent, the one seen longest ago first", async () => {
    const { pick } = picker([row(1, "pes"), row(2, "kočka"), row(3, "dům"), row(4, "strom")]);

    // Newest first: "dům" was the last word, "pes" the oldest of the sent ones.
    const deck = await pick(7, 4, ["dům", "kočka", "pes"]);

    expect(deck.map((card) => card.original)).toEqual(["strom", "pes", "kočka"]);
  });

  it("does not let a word due all along lead every deck once it was sent", async () => {
    const { pick } = picker([row(1, "pes")], [row(2, "kočka"), row(3, "dům")]);

    // "pes" stays due because nobody graded it; it was sent two decks ago.
    const deck = await pick(7, 1, ["kočka", "pes"]);

    expect(deck.map((card) => card.original)).toEqual(["dům"]);
  });

  it("shuffles the words not due yet instead of always taking the same one", async () => {
    const ahead = [row(1, "pes"), row(2, "kočka"), row(3, "dům")];
    const first = createReviewDeckPicker({
      findDueForSrs: vi.fn().mockResolvedValue([]),
      findAheadForSrs: vi.fn().mockResolvedValue(ahead),
      random: () => 0,
    });
    const last = createReviewDeckPicker({
      findDueForSrs: vi.fn().mockResolvedValue([]),
      findAheadForSrs: vi.fn().mockResolvedValue(ahead),
      random: () => 0.999,
    });

    const a = (await first(7, 3, [])).map((card) => card.original);
    const b = (await last(7, 3, [])).map((card) => card.original);

    expect(a).not.toEqual(b);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("does not bring the last word back through another language's practice-ahead row", async () => {
    const { pick } = picker([row(1, "pes")], [row(1, "pes", { translationId: 11, targetLangId: 3 }), row(2, "kočka")]);

    const deck = await pick(7, 2, ["pes"]);

    expect(deck.map((card) => [card.original, card.ahead])).toEqual([["kočka", true]]);
  });

  it("does not count a word already in the deck when topping up with words not due yet", async () => {
    const { pick } = picker(
      [row(1, "pes")],
      [row(1, "pes", { translationId: 12, targetLangId: 2 }), row(2, "kočka"), row(3, "dům")],
    );

    const deck = await pick(7, 3, []);

    expect(deck[0]?.original).toBe("pes");
    expect(deck.map((card) => card.entryId).sort()).toEqual([1, 2, 3]);
  });
});
