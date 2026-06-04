/**
 * TranslationRequest Repository Port.
 */
export interface TranslationRequest {
  id: number;
  userId: number;
  original: string;
  sourceLangCode: string | null;
  targetLangCodes: string[];
  creditCost: number;
  createdAt: Date;
}

export interface TranslationRequestRepository {
  logTranslationRequest(
    userId: number,
    original: string,
    sourceLangCode: string | null,
    targetLangCodes: string[],
    creditCost?: number,
  ): Promise<number>;
  getUserCreditsInWindow(userId: number, windowStart: Date): Promise<number>;
  getRecentRequests(userId: number, limit: number): Promise<TranslationRequest[]>;
}
