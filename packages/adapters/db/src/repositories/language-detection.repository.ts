import { desc, gte, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { languageDetectionEvents } from "../schema.js";

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

export interface RecordLanguageDetectionEventInput {
  userId?: number;
  eventType: "warning_shown" | "confirmed" | "cancelled";
  word: string;
  sourceLang?: string;
  targetLangs?: string[];
}

export interface LanguageDetectionDaySummary {
  date: string;
  warningShown: number;
  confirmed: number;
  cancelled: number;
}

export interface LanguageDetectionOutcomeSummary {
  totalWarnings: number;
  totalConfirmed: number;
  totalCancelled: number;
  confirmRate: number;
}

export const languageDetectionRepository = {
  async record(input: RecordLanguageDetectionEventInput): Promise<void> {
    const db = getDb();
    try {
      await db.insert(languageDetectionEvents).values({
        userId: input.userId,
        eventType: input.eventType,
        word: input.word,
        sourceLang: input.sourceLang,
        targetLangs: input.targetLangs,
      });
    } catch (err) {
      if (isMissingTableError(err)) {
        return;
      }
      throw err;
    }
  },

  async getSummaryByDay(days = 7): Promise<LanguageDetectionDaySummary[]> {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        date: sql<string>`to_char(${languageDetectionEvents.createdAt}, 'YYYY-MM-DD')`,
        warningShown: sql<number>`count(*) filter (where ${languageDetectionEvents.eventType} = 'warning_shown')::int`,
        confirmed: sql<number>`count(*) filter (where ${languageDetectionEvents.eventType} = 'confirmed')::int`,
        cancelled: sql<number>`count(*) filter (where ${languageDetectionEvents.eventType} = 'cancelled')::int`,
      })
      .from(languageDetectionEvents)
      .where(gte(languageDetectionEvents.createdAt, since))
      .groupBy(sql`to_char(${languageDetectionEvents.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(desc(sql`to_char(${languageDetectionEvents.createdAt}, 'YYYY-MM-DD')`));

    return rows.map((row) => ({
      date: row.date,
      warningShown: row.warningShown,
      confirmed: row.confirmed,
      cancelled: row.cancelled,
    }));
  },

  async getSummaryByOutcome(days = 7): Promise<LanguageDetectionOutcomeSummary> {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        totalWarnings: sql<number>`count(*) filter (where ${languageDetectionEvents.eventType} = 'warning_shown')::int`,
        totalConfirmed: sql<number>`count(*) filter (where ${languageDetectionEvents.eventType} = 'confirmed')::int`,
        totalCancelled: sql<number>`count(*) filter (where ${languageDetectionEvents.eventType} = 'cancelled')::int`,
      })
      .from(languageDetectionEvents)
      .where(gte(languageDetectionEvents.createdAt, since));

    const row = rows[0] ?? { totalWarnings: 0, totalConfirmed: 0, totalCancelled: 0 };
    const totalDecisions = row.totalConfirmed + row.totalCancelled;
    const confirmRate = totalDecisions > 0 ? row.totalConfirmed / totalDecisions : 0;

    return {
      totalWarnings: row.totalWarnings,
      totalConfirmed: row.totalConfirmed,
      totalCancelled: row.totalCancelled,
      confirmRate,
    };
  },
};
