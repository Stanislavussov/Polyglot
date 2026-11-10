import type { VocabDifficulty, VocabularyRepository } from "../../ports/vocabulary.repository.js";
import type { WordReviewRepository } from "../../ports/word-review.repository.js";
import { scheduleCardRating } from "./cards-deck.js";
import type { SrsRating, SrsReviewResult } from "./types.js";

/** The notification grade each rating writes, so a word keeps one grade across notifications and Cards. */
export const DIFFICULTY_BY_RATING: Record<SrsRating, VocabDifficulty> = {
  again: "hard",
  hard: "hard",
  good: "normal",
  easy: "easy",
};

export interface RateEntryPorts {
  vocabulary: Pick<VocabularyRepository, "setDifficulty" | "findEntrySrsRows" | "updateSrsState">;
  reviews: Pick<WordReviewRepository, "logReview">;
}

/**
 * Reschedules every live language row of one owned entry. The deck shows every
 * language, so one rating covers all of them; each row is scheduled from its *own*
 * SM-2 state — copying the rated row's numbers across would reset schedules the
 * reader earned in another language — and a row still ahead of its due date is
 * practice ahead. Returns the state written per translation id; rows SM-2 declined
 * to touch are absent.
 */
export async function rescheduleEntry(
  vocabulary: RateEntryPorts["vocabulary"],
  userId: number,
  entryId: number,
  rating: SrsRating,
  options: { retry?: boolean } = {},
  now: Date = new Date(),
): Promise<Map<number, SrsReviewResult>> {
  const rows = await vocabulary.findEntrySrsRows(userId, entryId);
  const written = new Map<number, SrsReviewResult>();
  for (const row of rows) {
    const next = scheduleCardRating(
      // `dueDate` is unused by SM-2; `ahead` carries everything it says.
      { easeFactor: row.srsEaseFactor, interval: row.srsInterval, reviewCount: row.srsReviewCount, dueDate: null },
      rating,
      { ahead: row.srsDueDate !== null && row.srsDueDate.getTime() > now.getTime(), retry: options.retry },
      now,
    );
    if (!next) continue;
    await vocabulary.updateSrsState(row.translationId, next);
    written.set(row.translationId, next);
  }
  return written;
}

/**
 * A first rating of an entry, as every channel records it: the notification grade,
 * the schedule and the review log. Null when the entry is not the user's (or gone).
 */
export async function rateEntry(
  ports: RateEntryPorts,
  userId: number,
  entryId: number,
  rating: SrsRating,
  sessionType: string,
  options: { retry?: boolean } = {},
  now: Date = new Date(),
): Promise<Map<number, SrsReviewResult> | null> {
  const saved = await ports.vocabulary.setDifficulty(entryId, userId, DIFFICULTY_BY_RATING[rating]);
  if (!saved) return null;
  const written = await rescheduleEntry(ports.vocabulary, userId, entryId, rating, options, now);
  await ports.reviews.logReview(userId, entryId, sessionType);
  return written;
}
