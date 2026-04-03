import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { wordReviewLog } from "../schema.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type WordReview = typeof wordReviewLog.$inferSelect;

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const wordReviewRepository = {
  /**
   * Log that a vocabulary entry was reviewed in a session.
   * Inserts a row into word_review_log.
   */
  async logReview(userId: number, entryId: number, sessionType: string): Promise<void> {
    const db = getDb();
    await db.insert(wordReviewLog).values({
      userId,
      entryId,
      sessionType,
    });
  },

  /**
   * Get review counts per vocabulary entry for the given user.
   * Returns Map<entryId, reviewCount>.
   * Entries with no reviews are NOT in the map (treat as 0 externally).
   */
  async getReviewCounts(userId: number): Promise<Map<number, number>> {
    const db = getDb();
    const rows = await db
      .select({
        entryId: wordReviewLog.entryId,
        reviewCount: count(wordReviewLog.id),
      })
      .from(wordReviewLog)
      .where(eq(wordReviewLog.userId, userId))
      .groupBy(wordReviewLog.entryId);

    const result = new Map<number, number>();
    for (const row of rows) {
      result.set(row.entryId, row.reviewCount);
    }
    return result;
  },

  /**
   * Get reviews for a single vocabulary entry.
   * Returns reviews in descending order (most recent first).
   * For SRS scheduling and review history.
   */
  async getReviewsForWord(entryId: number, limit?: number): Promise<WordReview[]> {
    const db = getDb();
    const query = db
      .select()
      .from(wordReviewLog)
      .where(eq(wordReviewLog.entryId, entryId))
      .orderBy(desc(wordReviewLog.reviewedAt));

    if (limit) {
      return query.limit(limit);
    }
    return query;
  },

  /**
   * Get reviews for a user filtered by session type.
   * Useful for analytics (e.g. how many flashcard sessions).
   */
  async getReviewsBySessionType(userId: number, sessionType: string, limit?: number): Promise<WordReview[]> {
    const db = getDb();
    const query = db
      .select()
      .from(wordReviewLog)
      .where(and(eq(wordReviewLog.userId, userId), eq(wordReviewLog.sessionType, sessionType)))
      .orderBy(desc(wordReviewLog.reviewedAt));

    if (limit) {
      return query.limit(limit);
    }
    return query;
  },
};
