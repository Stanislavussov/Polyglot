import { buildCardsDeck, type CardsDeckCard, type SrsDueVocabularyCard } from "@polyglot/core";

export interface ReviewDeckPickerDeps {
  findDueForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
  findAheadForSrs(userId: number, now: Date, limit: number): Promise<SrsDueVocabularyCard[]>;
}

/** Rows fetched per card wanted, and the factor each further page grows by. */
const CANDIDATE_OVERSHOOT = 4;
/** Where the widening stops: a dictionary this deep has plenty of distinct words by then. */
const MAX_CANDIDATES = 1000;

type FetchRows = (limit: number) => Promise<SrsDueVocabularyCard[]>;

/**
 * Rows of words neither recently sent nor already `taken` by the deck, widened until they
 * hold `size` distinct words or the pool runs out. The limit counts translation rows while
 * the deck wants words, and a learner of several languages gets several rows per word — a
 * fixed limit could fill up with them and underfill the deck even though more eligible
 * words exist. `taken` matters for the ahead top-up: a word due in one language can be
 * ahead in another, and counting it again would stop the search one word short.
 */
async function freshCandidates(
  fetch: FetchRows,
  size: number,
  recent: ReadonlySet<string>,
  taken: ReadonlySet<number> = new Set(),
) {
  let limit = size * CANDIDATE_OVERSHOOT + recent.size + taken.size;
  for (;;) {
    const rows = await fetch(limit);
    const fresh = rows.filter((row) => !recent.has(row.original) && !taken.has(row.entryId));
    const exhausted = rows.length < limit || limit >= MAX_CANDIDATES;
    if (exhausted || new Set(fresh.map((row) => row.entryId)).size >= size) return fresh;
    limit = Math.min(limit * CANDIDATE_OVERSHOOT, MAX_CANDIDATES);
  }
}

/**
 * The deck a card notification opens on — the `/review` deck's own order
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
    const recent = new Set(recentWords);
    const due = await freshCandidates((limit) => deps.findDueForSrs(userId, now, limit), size, recent);
    const deck = buildCardsDeck(due, [], size);
    if (deck.length >= size) return deck;
    const ahead = await freshCandidates(
      (limit) => deps.findAheadForSrs(userId, now, limit),
      size - deck.length,
      recent,
      new Set(deck.map((card) => card.entryId)),
    );
    return buildCardsDeck(due, ahead, size);
  };
}
