/**
 * TranslationRequest Repository Port.
 */
export interface TranslationRequest {
  id: number;
  userId: number;
  original: string;
  sourceLangCode: string | null;
  targetLangCodes: string[];
  createdAt: Date;
}

export interface TranslationRequestRepository {
  logTranslationRequest(
    userId: number,
    original: string,
    sourceLangCode: string | null,
    targetLangCodes: string[],
  ): Promise<number>;
  getRecentRequests(userId: number, limit: number): Promise<TranslationRequest[]>;
}
