import type { TranslationRequest } from "@polyglot/core";
import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { getDb } from "../connection.js";
import { languages, translationRequests, translationRequestTargetLangs, userDailyRequestCounts } from "../schema.js";

export type { TranslationRequest };

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
    creditCost = 1,
  ): Promise<number> {
    const db = getDb();

    // Write the ledger entry and its target-language rows atomically (E9/T18):
    // the request and its junction rows must never be split by a mid-write
    // failure, which would corrupt credit accounting.
    return db.transaction(async (tx) => {
      // Resolve source language code to ID
      let sourceLangId: number | null = null;
      if (sourceLangCode) {
        const rows = await tx
          .select({ id: languages.id })
          .from(languages)
          .where(eq(languages.code, sourceLangCode))
          .limit(1);
        sourceLangId = rows[0]?.id ?? null;
      }

      // Insert the request
      const [request] = await tx
        .insert(translationRequests)
        .values({ userId, original, sourceLangId, creditCost })
        .returning({ id: translationRequests.id });

      const requestId = request!.id;

      // Resolve target language codes to IDs and insert junction rows
      if (targetLangCodes.length > 0) {
        const targetLangs = await tx
          .select({ id: languages.id })
          .from(languages)
          .where(inArray(languages.code, targetLangCodes));

        const junctionValues = targetLangs.map((lang) => ({
          requestId,
          languageId: lang.id,
        }));

        if (junctionValues.length > 0) {
          await tx.insert(translationRequestTargetLangs).values(junctionValues);
        }
      }

      // Bump the compact per-user/per-day counter (Fable T25/E5). This is the
      // pre-aggregated source the admin per-day count reader uses instead of a
      // GROUP BY over the unboundedly-growing ledger. The calendar day is taken
      // in UTC so the bucket does not depend on the container/process timezone.
      const utcDay = new Date().toISOString().slice(0, 10);
      await tx
        .insert(userDailyRequestCounts)
        .values({ userId, day: utcDay, requestCount: 1 })
        .onConflictDoUpdate({
          target: [userDailyRequestCounts.userId, userDailyRequestCounts.day],
          set: { requestCount: sql`${userDailyRequestCounts.requestCount} + 1` },
        });

      return requestId;
    });
  },

  /**
   * Sum translation credits a user has consumed since `windowStart`.
   * Used for rate limiting.
   */
  async getUserCreditsInWindow(userId: number, windowStart: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ value: sum(translationRequests.creditCost) })
      .from(translationRequests)
      .where(and(eq(translationRequests.userId, userId), gte(translationRequests.createdAt, windowStart)));
    const value = rows[0]?.value;
    return value ? Number(value) : 0;
  },

  async countRequestsInWindow(userId: number, original: string, windowStart: Date): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ value: count() })
      .from(translationRequests)
      .where(
        and(
          eq(translationRequests.userId, userId),
          eq(translationRequests.original, original),
          gte(translationRequests.createdAt, windowStart),
        ),
      );
    return Number(rows[0]?.value ?? 0);
  },

  /**
   * Get recent translation requests for a user, with language codes resolved.
   * Returns DTOs with language codes (strings), never IDs.
   */
  async getRecentRequests(userId: number, limit: number): Promise<TranslationRequest[]> {
    const db = getDb();

    // Fetch requests with source language join
    const requests = await db
      .select({
        id: translationRequests.id,
        userId: translationRequests.userId,
        original: translationRequests.original,
        sourceLangCode: languages.code,
        creditCost: translationRequests.creditCost,
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
      creditCost: r.creditCost,
      createdAt: r.createdAt,
    }));
  },
};
