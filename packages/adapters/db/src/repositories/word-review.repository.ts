import { getDb } from "../connection.js";
import { wordReviewLog } from "../schema.js";

export const wordReviewRepository = {
  async logReview(userId: number, entryId: number, sessionType: string): Promise<void> {
    const db = getDb();
    await db.insert(wordReviewLog).values({
      userId,
      entryId,
      sessionType,
    });
  },
};
