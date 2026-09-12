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

/**
 * Ledger rows that are NOT translations, by their `original`.
 *
 * Every paid AI call shares `translation_requests` and writes a `[callType]`
 * original (`recordAiUsage`), but only some of them are translations of the
 * user's own text. The monthly translation allowance must not bill the ones that
 * are not: a free plan holds the grammar breakdown from Task 84 on, and billing
 * a grammar tap to the translation cap would mean a free user's card taps
 * silently eat the translations the tier promises.
 *
 * Deliberately a short deny-list rather than "everything in brackets": a
 * dictionary translation and a word pick ARE billed to the monthly window, as
 * they always were, and widening this to every tagged row would have quietly
 * lifted their monthly ceiling. A new `AiCallType` therefore has to make a
 * decision here — `apps/bot/src/utils/ai-quota.test.ts` fails until it does.
 */
export const NON_TRANSLATION_LEDGER_TAGS: readonly string[] = ["[grammar]"];

export interface TranslationRequestRepository {
  logTranslationRequest(
    userId: number,
    original: string,
    sourceLangCode: string | null,
    targetLangCodes: string[],
    creditCost?: number,
  ): Promise<number>;
  getUserCreditsInWindow(userId: number, windowStart: Date): Promise<number>;
  /**
   * Credits spent on TRANSLATIONS since `windowStart` — the thing the monthly
   * allowance is named after. Excludes exactly {@link NON_TRANSLATION_LEDGER_TAGS}.
   */
  getTranslationCreditsInWindow(userId: number, windowStart: Date): Promise<number>;
  /**
   * How many ledger rows with this exact `original` marker (e.g. "[mentor]")
   * the user has logged since `windowStart` — per-feature daily caps count
   * calls, not credits.
   */
  countRequestsInWindow(userId: number, original: string, windowStart: Date): Promise<number>;
  getRecentRequests(userId: number, limit: number): Promise<TranslationRequest[]>;
}
