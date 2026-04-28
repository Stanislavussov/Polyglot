/**
 * Word Review Repository Port.
 */
export interface WordReview {
  id: number;
  userId: number;
  entryId: number;
  sessionType: string;
  reviewedAt: Date;
}
export interface WordReviewRepository {
  logReview(userId: number, entryId: number, sessionType: string): Promise<void>;
  getReviewCounts(userId: number): Promise<Map<number, number>>;
  getReviewsForWord(entryId: number, limit?: number): Promise<WordReview[]>;
  getReviewsBySessionType(userId: number, sessionType: string, limit?: number): Promise<WordReview[]>;
}
