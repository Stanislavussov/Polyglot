import { describe, expect, it } from "vitest";
import type { SrsDueVocabularyCard } from "../../ports/vocabulary.repository.js";
import { buildCardsDeck, scheduleCardRating } from "./cards-deck.js";

function row(
  translationId: number,
  entryId: number,
  overrides: Partial<SrsDueVocabularyCard> = {},
): SrsDueVocabularyCard {
  return {
    translationId,
    entryId,
    original: `word-${entryId}`,
    sourceLangId: 1,
    targetLangId: 2,
    inputType: "word",
    emoji: null,
    nativeMeaning: null,
    sourceUsage: null,
    text: `text-${translationId}`,
    expressionType: null,
    equivalentNote: null,
    usageNote: null,
    connotationWarning: null,
    details: null,
    difficulty: null,
    srsEaseFactor: 2.5,
    srsInterval: 6,
    srsDueDate: null,
    srsReviewCount: 2,
    ...overrides,
  };
}

const ids = (deck: ReadonlyArray<{ translationId: number }>) => deck.map((card) => card.translationId);

describe("buildCardsDeck", () => {
  it("puts due cards first, in the order they were fetched, and marks them not ahead", () => {
    const deck = buildCardsDeck([row(1, 10), row(2, 20)], [row(3, 30)], 10);

    expect(ids(deck)).toEqual([1, 2, 3]);
    expect(deck.map((card) => card.ahead)).toEqual([false, false, true]);
  });

  it("keeps at most one card per entry, so a word saved in two languages appears once", () => {
    const deck = buildCardsDeck([row(1, 10), row(2, 10), row(3, 20)], [row(4, 20), row(5, 30), row(6, 30)], 10);

    expect(ids(deck)).toEqual([1, 3, 5]);
  });

  it("tops up with practice-ahead cards only while the due cards leave room", () => {
    const deck = buildCardsDeck([row(1, 10), row(2, 20)], [row(3, 30), row(4, 40)], 3);

    expect(ids(deck)).toEqual([1, 2, 3]);
  });

  it("never exceeds the session size, even with more due cards than fit", () => {
    const deck = buildCardsDeck([row(1, 10), row(2, 20), row(3, 30)], [row(4, 40)], 2);

    expect(ids(deck)).toEqual([1, 2]);
    expect(deck.every((card) => !card.ahead)).toBe(true);
  });

  it("builds an ahead-only deck when nothing is due", () => {
    const deck = buildCardsDeck([], [row(3, 30), row(4, 40)], 10);

    expect(ids(deck)).toEqual([3, 4]);
    expect(deck.every((card) => card.ahead)).toBe(true);
  });

  it("is empty only when there is nothing to review at all", () => {
    expect(buildCardsDeck([], [], 10)).toEqual([]);
  });
});

describe("scheduleCardRating", () => {
  const now = new Date("2026-06-04T10:00:00.000Z");
  const state = { easeFactor: 2.5, interval: 10, reviewCount: 3, dueDate: new Date("2026-06-10T10:00:00.000Z") };

  it.each(["again", "hard", "good", "easy"] as const)("applies SM-2 to a due card rated %s", (rating) => {
    const result = scheduleCardRating(state, rating, { ahead: false }, now);

    expect(result).not.toBeNull();
    expect(result?.rating).toBe(rating);
    expect(result?.reviewCount).toBe(4);
  });

  it("gives a due card rated good the regular SM-2 interval", () => {
    expect(scheduleCardRating(state, "good", { ahead: false }, now)?.interval).toBe(25);
  });

  it("brings an ahead card rated again back tomorrow", () => {
    const result = scheduleCardRating(state, "again", { ahead: true }, now);

    expect(result?.interval).toBe(1);
    expect(result?.dueDate.toISOString()).toBe("2026-06-05T10:00:00.000Z");
    expect(result?.easeFactor).toBe(2.3);
  });

  it("pulls an ahead card rated hard closer: ease down 0.15, interval halved", () => {
    const result = scheduleCardRating(state, "hard", { ahead: true }, now);

    expect(result?.easeFactor).toBe(2.35);
    expect(result?.interval).toBe(5);
    expect(result?.dueDate.toISOString()).toBe("2026-06-09T10:00:00.000Z");
    expect(result?.reviewCount).toBe(3);
  });

  it("keeps an ahead hard card at least one day out and the ease above its floor", () => {
    const result = scheduleCardRating({ ...state, easeFactor: 1.35, interval: 1 }, "hard", { ahead: true }, now);

    expect(result?.interval).toBe(1);
    expect(result?.easeFactor).toBe(1.3);
    expect(result?.dueDate.toISOString()).toBe("2026-06-05T10:00:00.000Z");
  });

  it.each(["good", "easy"] as const)("writes nothing for an ahead card rated %s", (rating) => {
    expect(scheduleCardRating(state, rating, { ahead: true }, now)).toBeNull();
  });

  it.each(["again", "hard", "good", "easy"] as const)("writes nothing for a retry rated %s", (rating) => {
    expect(scheduleCardRating(state, rating, { ahead: false, retry: true }, now)).toBeNull();
    expect(scheduleCardRating(state, rating, { ahead: true, retry: true }, now)).toBeNull();
  });
});
