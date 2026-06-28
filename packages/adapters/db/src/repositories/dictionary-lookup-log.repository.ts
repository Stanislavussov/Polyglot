import type { DictionaryContextMatchType } from "@polyglot/core";
import { desc, gte, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { dictionaryLookupLogs } from "../schema.js";

const POSTGRES_UNDEFINED_TABLE = "42P01";

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const candidate = (err as { cause?: unknown }).cause ?? err;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  return (candidate as { code?: unknown }).code === POSTGRES_UNDEFINED_TABLE;
}

export interface RecordDictionaryLookupLogInput {
  lookupInput: string;
  normalizedInput: string;
  langCode: string;
  matched: boolean;
  matchCount: number;
  matchedWord?: string;
  matchType?: DictionaryContextMatchType;
  matchedPos?: string;
  matchedGlosses?: string[];
  error?: string;
}

export interface DictionaryLookupLogRow {
  id: number;
  lookupInput: string;
  normalizedInput: string;
  langCode: string;
  matched: boolean;
  matchCount: number;
  matchedWord: string | null;
  matchType: string | null;
  matchedPos: string | null;
  matchedGlosses: string[] | null;
  error: string | null;
  createdAt: Date;
}

export interface DictionaryLookupLogList {
  logs: DictionaryLookupLogRow[];
  total: number;
  page: number;
  limit: number;
}

export interface DictionaryLookupSummary {
  totalLookups: number;
  matchedLookups: number;
  failedLookups: number;
  matchRate: number;
}

export const dictionaryLookupLogRepository = {
  async record(input: RecordDictionaryLookupLogInput): Promise<void> {
    const db = getDb();
    try {
      await db.insert(dictionaryLookupLogs).values({
        lookupInput: input.lookupInput,
        normalizedInput: input.normalizedInput,
        langCode: input.langCode,
        matched: input.matched,
        matchCount: input.matchCount,
        matchedWord: input.matchedWord,
        matchType: input.matchType,
        matchedPos: input.matchedPos,
        matchedGlosses: input.matchedGlosses,
        error: input.error,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return;
      }
      throw err;
    }
  },

  async listRecent(page = 1, limit = 50): Promise<DictionaryLookupLogList> {
    const db = getDb();
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(200, limit));
    const offset = (safePage - 1) * safeLimit;

    const [logs, totalRows] = await Promise.all([
      db
        .select()
        .from(dictionaryLookupLogs)
        .orderBy(desc(dictionaryLookupLogs.createdAt))
        .limit(safeLimit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(dictionaryLookupLogs),
    ]);

    return {
      logs,
      total: totalRows[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    };
  },

  async getSummary(days = 7): Promise<DictionaryLookupSummary> {
    const db = getDb();
    const safeDays = Math.max(1, Math.min(90, days));
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        totalLookups: sql<number>`count(*)::int`,
        matchedLookups: sql<number>`count(*) filter (where ${dictionaryLookupLogs.matched})::int`,
        failedLookups: sql<number>`count(*) filter (where ${dictionaryLookupLogs.error} is not null)::int`,
      })
      .from(dictionaryLookupLogs)
      .where(gte(dictionaryLookupLogs.createdAt, since));

    const row = rows[0] ?? { totalLookups: 0, matchedLookups: 0, failedLookups: 0 };
    return {
      totalLookups: row.totalLookups,
      matchedLookups: row.matchedLookups,
      failedLookups: row.failedLookups,
      matchRate: row.totalLookups > 0 ? row.matchedLookups / row.totalLookups : 0,
    };
  },
};
