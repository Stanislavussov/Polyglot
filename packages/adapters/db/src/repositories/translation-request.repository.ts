import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../index.js";
import { languages, translationRequests, translationRequestTargetLangs } from "../schema.js";

/** DTO returned by getRecentRequests — uses language codes, not IDs. */
export interface TranslationRequestDTO {
  id: number;
  userId: number;
  original: string;
  sourceLangCode: string | null;
  targetLangCodes: string[];
  createdAt: Date;
}

export const translationRequestRepository = {
  /**
   * Log a new translation request with proper FK references.
   * Accepts language codes (strings) — resolves to language IDs internally.
   * Returns the inserted request ID.
   */
  async logTranslationRequest(
    userId: number,
    original: string,
    sourceLangCode: string | null,
    targetLangCodes: string[],
  ): Promise<number> {
    const db = getDb();

    // Resolve source language code to ID
    let sourceLangId: number | null = null;
    if (sourceLangCode) {
      const rows = await db
        .select({ id: languages.id })
        .from(languages)
        .where(eq(languages.code, sourceLangCode))
        .limit(1);
      sourceLangId = rows[0]?.id ?? null;
    }

    // Insert the request
    const [request] = await db
      .insert(translationRequests)
      .values({ userId, original, sourceLangId })
      .returning({ id: translationRequests.id });

    const requestId = request!.id;

    // Resolve target language codes to IDs and insert junction rows
    if (targetLangCodes.length > 0) {
      const targetLangs = await db
        .select({ id: languages.id })
        .from(languages)
        .where(inArray(languages.code, targetLangCodes));

      const junctionValues = targetLangs.map((lang) => ({
        requestId,
        languageId: lang.id,
      }));

      if (junctionValues.length > 0) {
        await db.insert(translationRequestTargetLangs).values(junctionValues);
      }
    }

    return requestId;
  },

  /**
   * Count how many translation requests a user has made since `windowStart`.
   * Used for rate limiting.
   */
  async getUserRequestsInWindow(userId: number, windowStart: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ value: count() })
      .from(translationRequests)
      .where(and(eq(translationRequests.userId, userId), gte(translationRequests.createdAt, windowStart)));
    return rows[0]?.value ?? 0;
  },

  /**
   * Get recent translation requests for a user, with language codes resolved.
   * Returns DTOs with language codes (strings), never IDs.
   */
  async getRecentRequests(userId: number, limit: number): Promise<TranslationRequestDTO[]> {
    const db = getDb();

    // Fetch requests with source language join
    const requests = await db
      .select({
        id: translationRequests.id,
        userId: translationRequests.userId,
        original: translationRequests.original,
        sourceLangCode: languages.code,
        createdAt: translationRequests.createdAt,
      })
      .from(translationRequests)
      .leftJoin(languages, eq(translationRequests.sourceLangId, languages.id))
      .where(eq(translationRequests.userId, userId))
      .orderBy(desc(translationRequests.createdAt))
      .limit(limit);

    if (requests.length === 0) return [];

    // Fetch target languages for all these requests
    const requestIds = requests.map((r) => r.id);

    const targetRows = await db
      .select({
        requestId: translationRequestTargetLangs.requestId,
        code: languages.code,
      })
      .from(translationRequestTargetLangs)
      .innerJoin(languages, eq(translationRequestTargetLangs.languageId, languages.id))
      .where(inArray(translationRequestTargetLangs.requestId, requestIds));

    // Group target lang codes by request ID
    const targetsByRequestId = new Map<number, string[]>();
    for (const row of targetRows) {
      const arr = targetsByRequestId.get(row.requestId) ?? [];
      arr.push(row.code);
      targetsByRequestId.set(row.requestId, arr);
    }

    return requests.map((r) => ({
      id: r.id,
      userId: r.userId,
      original: r.original,
      sourceLangCode: r.sourceLangCode,
      targetLangCodes: targetsByRequestId.get(r.id) ?? [],
      createdAt: r.createdAt,
    }));
  },
};
