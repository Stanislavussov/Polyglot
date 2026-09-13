import type { SrsDueVocabularyCard } from "../../ports/vocabulary.repository.js";
import { applySm2Review } from "./sm2.js";
import type { SrsRating, SrsReviewResult, SrsState } from "./types.js";

/**
 * One card of a Cards session. `ahead` is decided when the deck is built and the due
 * date is dropped: the session is stored as jsonb, where a Date comes back a string.
 */
export interface CardsDeckCard extends Omit<SrsDueVocabularyCard, "srsDueDate"> {
  ahead: boolean;
  /** The single in-session repeat an "again" earns; rating it writes nothing. */
  retry?: boolean;
}

/**
 * Due rows first, then not-yet-due rows, at most one card per entry, capped at
 * `limit`. Both inputs arrive already ordered by the repository.
 */
export function buildCardsDeck(
  due: readonly SrsDueVocabularyCard[],
  ahead: readonly SrsDueVocabularyCard[],
  limit: number,
): CardsDeckCard[] {
  const deck: CardsDeckCard[] = [];
  const entries = new Set<number>();
  const take = (rows: readonly SrsDueVocabularyCard[], isAhead: boolean) => {
    for (const { srsDueDate: _dueDate, ...row } of rows) {
      if (deck.length >= limit) return;
      if (entries.has(row.entryId)) continue;
      entries.add(row.entryId);
      deck.push({ ...row, ahead: isAhead });
    }
  };
  take(due, false);
  take(ahead, true);
  return deck;
}

/**
 * The SRS state a rating produces, or null when it must not touch the schedule.
 *
 * An ahead card rated good/easy writes nothing: reviewing early is no evidence the
 * longer gap was survived. Rated again/hard it shows a weakness and pulls the word
 * closer. A retry was already scheduled on its first presentation.
 */
export function scheduleCardRating(
  state: SrsState,
  rating: SrsRating,
  card: { ahead: boolean; retry?: boolean },
  now: Date = new Date(),
): SrsReviewResult | null {
  if (card.retry) return null;
  if (!card.ahead || rating === "again") return applySm2Review(state, rating, now);
  if (rating !== "hard") return null;

  const interval = Math.max(1, Math.floor(state.interval / 2));
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + interval);
  return {
    rating,
    easeFactor: applySm2Review(state, "hard", now).easeFactor,
    interval,
    // Not a step up SM-2's ladder: the count decides the next good interval, and an
    // early "hard" has not earned that.
    reviewCount: state.reviewCount,
    dueDate,
  };
}
