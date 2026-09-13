/**
 * Word Review Repository Port.
 */
export interface WordReviewRepository {
  logReview(userId: number, entryId: number, sessionType: string): Promise<void>;
}
