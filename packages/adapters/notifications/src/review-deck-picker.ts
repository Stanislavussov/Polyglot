import { buildCardsDeck, type CardsDeckCard, type SrsDueVocabularyCard } from "@polyglot/core";

export interface ReviewDeckPickerDeps {
  findDueForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
  findAheadForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
}

/** Rows fetched per card wanted: one card per entry and the de-dup window both discard rows. */
const CANDIDATE_OVERSHOOT = 4;

/**
 * The deck a multi-card notification opens on — the `/review` deck's own order
 * (`buildCardsDeck`: due first, then practice-ahead, one card per entry), minus the
 * words a recent notification already carried.
 */
export function createReviewDeckPicker(deps: ReviewDeckPickerDeps) {
  return async function pickReviewDeck(
    userId: number,
    size: number,
    recentWords: string[],
    now: Date = new Date(),
  ): Promise<CardsDeckCard[]> {
    const limit = size * CANDIDATE_OVERSHOOT + recentWords.length;
    const recent = new Set(recentWords);
    const fresh = (rows: SrsDueVocabularyCard[]) => rows.filter((row) => !recent.has(row.original));

    const due = fresh(await deps.findDueForSrs(userId, now, limit));
    const deck = buildCardsDeck(due, [], size);
    if (deck.length >= size) return deck;
    return buildCardsDeck(due, fresh(await deps.findAheadForSrs(userId, now, limit)), size);
  };
}
