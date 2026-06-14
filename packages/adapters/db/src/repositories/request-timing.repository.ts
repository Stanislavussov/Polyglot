import { desc, gte, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { translationRequestTimings } from "../schema.js";

/**
 * PostgreSQL SQLSTATE for `undefined_table` — the table referenced by the
 * query does not exist. Surfaced by postgres.js as `error.code = "42P01"`
 * and wrapped by Drizzle as `DrizzleQueryError.cause`.
 */
const POSTGRES_UNDEFINED_TABLE = "42P01";

/**
 * Returns true if the thrown error means the translation_request_timings
 * table is missing from the database. The admin API treats this as "no data
 * yet" instead of a 500, so charts render an empty state until the
 * migration is applied.
 */
function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  // Drizzle wraps driver errors in DrizzleQueryError with a `cause` pointing
  // to the underlying postgres.js error. We also accept the raw shape in
  // case a non-drizzle caller bubbles the error up.
  const candidate = (err as { cause?: unknown }).cause ?? err;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  return (candidate as { code?: unknown }).code === POSTGRES_UNDEFINED_TABLE;
}

export interface RecordRequestTimingInput {
  userId?: number;
  requestType: string;
  preflightMs: number;
  dbLookupMs: number;
  aiRequestMs: number;
  totalMs: number;
  modelId?: string;
  sourceLang?: string;
  targetLangs?: string[];
  inputType?: string;
  success: boolean;
  error?: string;
}

export interface RequestTimingSegmentSummary {
  date: string;
  requestCount: number;
  avgPreflightMs: number;
  avgDbLookupMs: number;
  avgAiRequestMs: number;
  avgTotalMs: number;
  p95TotalMs: number;
  successRate: number;
}

export interface RequestTimingModelSummary {
  modelId: string;
  requestCount: number;
  avgPreflightMs: number;
  avgDbLookupMs: number;
  avgAiRequestMs: number;
  avgTotalMs: number;
  successRate: number;
}

export const requestTimingRepository = {
  async record(input: RecordRequestTimingInput): Promise<void> {
    const db = getDb();
    try {
      await db.insert(translationRequestTimings).values({
        userId: input.userId,
        requestType: input.requestType,
        preflightMs: input.preflightMs,
        dbLookupMs: input.dbLookupMs,
        aiRequestMs: input.aiRequestMs,
        totalMs: input.totalMs,
        modelId: input.modelId,
        sourceLang: input.sourceLang,
        targetLangs: input.targetLangs,
        inputType: input.inputType,
        success: input.success,
        error: input.error,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return;
      }
      throw err;
    }
  },

  async getSegmentSummaryByDay(days = 7): Promise<RequestTimingSegmentSummary[]> {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        date: sql<string>`to_char(${translationRequestTimings.createdAt}, 'YYYY-MM-DD')`,
        requestCount: sql<number>`count(*)::int`,
        avgPreflightMs: sql<number>`round(avg(${translationRequestTimings.preflightMs}))::int`,
        avgDbLookupMs: sql<number>`round(avg(${translationRequestTimings.dbLookupMs}))::int`,
        avgAiRequestMs: sql<number>`round(avg(${translationRequestTimings.aiRequestMs}))::int`,
        avgTotalMs: sql<number>`round(avg(${translationRequestTimings.totalMs}))::int`,
        p95TotalMs: sql<number>`percentile_cont(0.95) within group (order by ${translationRequestTimings.totalMs})::int`,
        successRate: sql<number>`coalesce(avg(case when ${translationRequestTimings.success} then 1.0 else 0.0 end), 0)`,
      })
      .from(translationRequestTimings)
      .where(gte(translationRequestTimings.createdAt, since))
      .groupBy(sql`to_char(${translationRequestTimings.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(desc(sql`to_char(${translationRequestTimings.createdAt}, 'YYYY-MM-DD')`));

    return rows.map((row) => ({
      date: row.date,
      requestCount: row.requestCount,
      avgPreflightMs: row.avgPreflightMs,
      avgDbLookupMs: row.avgDbLookupMs,
      avgAiRequestMs: row.avgAiRequestMs,
      avgTotalMs: row.avgTotalMs,
      p95TotalMs: row.p95TotalMs,
      successRate: Number(row.successRate),
    }));
  },

  async getSegmentSummaryByModel(days = 7, limit = 12): Promise<RequestTimingModelSummary[]> {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        modelId: translationRequestTimings.modelId,
        requestCount: sql<number>`count(*)::int`,
        avgPreflightMs: sql<number>`round(avg(${translationRequestTimings.preflightMs}))::int`,
        avgDbLookupMs: sql<number>`round(avg(${translationRequestTimings.dbLookupMs}))::int`,
        avgAiRequestMs: sql<number>`round(avg(${translationRequestTimings.aiRequestMs}))::int`,
        avgTotalMs: sql<number>`round(avg(${translationRequestTimings.totalMs}))::int`,
        successRate: sql<number>`coalesce(avg(case when ${translationRequestTimings.success} then 1.0 else 0.0 end), 0)`,
      })
      .from(translationRequestTimings)
      .where(gte(translationRequestTimings.createdAt, since))
      .groupBy(translationRequestTimings.modelId)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

    return rows.map((row) => ({
      modelId: row.modelId ?? "unknown",
      requestCount: row.requestCount,
      avgPreflightMs: row.avgPreflightMs,
      avgDbLookupMs: row.avgDbLookupMs,
      avgAiRequestMs: row.avgAiRequestMs,
      avgTotalMs: row.avgTotalMs,
      successRate: Number(row.successRate),
    }));
  },
};
