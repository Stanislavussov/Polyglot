/**
 * Telemetry retention (Fable T25/E5).
 *
 * None of the append-only telemetry/log tables had any retention horizon, so
 * they grew forever. This service deletes rows older than a configurable horizon
 * (default 90 days) from every pure-telemetry table, including the PII-bearing
 * text columns (`translation_requests.original`, `dictionary_lookup_logs.lookup_input`).
 *
 * It runs as a periodic DELETE rather than partitioning because the schema is
 * driven by drizzle-kit, which cannot generate `PARTITION BY`, and hand-editing
 * migrations / raw SQL is forbidden in this repo.
 *
 * The cutoff is derived from `Date.now()` (a UTC instant) and compared against
 * `timestamptz` columns, so the horizon does not depend on the container/process
 * timezone.
 */
import { lt } from "drizzle-orm";
import { getDb } from "./connection.js";
import {
  aiRequestLatencies,
  botSessions,
  dictionaryLookupLogs,
  languageDetectionEvents,
  momentumEvents,
  notificationHistory,
  translationRequests,
  translationRequestTimings,
  userDailyRequestCounts,
  wordReviewLog,
} from "./schema.js";

/** Default retention horizon in days. Overridable per call / via env at the caller. */
export const DEFAULT_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Rows deleted per table, keyed by table name. */
export type RetentionResult = Record<string, number>;

/**
 * Delete telemetry rows older than `retentionDays` from every log table.
 *
 * @param retentionDays horizon in days; rows with a timestamp strictly older than
 *   `now - retentionDays` are removed. Fresh rows are always kept.
 * @returns the number of rows deleted from each table.
 */
export async function runTelemetryRetention(retentionDays = DEFAULT_RETENTION_DAYS): Promise<RetentionResult> {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);
  const cutoffDay = cutoff.toISOString().slice(0, 10);

  const [
    dictionaryLookupLogsDeleted,
    translationRequestsDeleted,
    translationRequestTimingsDeleted,
    aiRequestLatenciesDeleted,
    languageDetectionEventsDeleted,
    notificationHistoryDeleted,
    wordReviewLogDeleted,
    momentumEventsDeleted,
    botSessionsDeleted,
    userDailyRequestCountsDeleted,
  ] = await Promise.all([
    db
      .delete(dictionaryLookupLogs)
      .where(lt(dictionaryLookupLogs.createdAt, cutoff))
      .returning({ id: dictionaryLookupLogs.id }),
    // translation_request_target_langs is cleaned up via ON DELETE CASCADE.
    db.delete(translationRequests).where(lt(translationRequests.createdAt, cutoff)).returning({
      id: translationRequests.id,
    }),
    db
      .delete(translationRequestTimings)
      .where(lt(translationRequestTimings.createdAt, cutoff))
      .returning({ id: translationRequestTimings.id }),
    db
      .delete(aiRequestLatencies)
      .where(lt(aiRequestLatencies.createdAt, cutoff))
      .returning({ id: aiRequestLatencies.id }),
    db
      .delete(languageDetectionEvents)
      .where(lt(languageDetectionEvents.createdAt, cutoff))
      .returning({ id: languageDetectionEvents.id }),
    db.delete(notificationHistory).where(lt(notificationHistory.sentAt, cutoff)).returning({
      id: notificationHistory.id,
    }),
    db.delete(wordReviewLog).where(lt(wordReviewLog.reviewedAt, cutoff)).returning({ id: wordReviewLog.id }),
    // The `user_momentum` snapshot is deliberately never pruned: it is the durable
    // score, while this journal is only its audit trail.
    db.delete(momentumEvents).where(lt(momentumEvents.occurredAt, cutoff)).returning({ id: momentumEvents.id }),
    // Stale grammY sessions: an active chat re-touches `updated_at` on every turn,
    // so only long-abandoned sessions fall past the horizon.
    db.delete(botSessions).where(lt(botSessions.updatedAt, cutoff)).returning({ key: botSessions.key }),
    db
      .delete(userDailyRequestCounts)
      .where(lt(userDailyRequestCounts.day, cutoffDay))
      .returning({ userId: userDailyRequestCounts.userId }),
  ]);

  return {
    dictionary_lookup_logs: dictionaryLookupLogsDeleted.length,
    translation_requests: translationRequestsDeleted.length,
    translation_request_timings: translationRequestTimingsDeleted.length,
    ai_request_latencies: aiRequestLatenciesDeleted.length,
    language_detection_events: languageDetectionEventsDeleted.length,
    notification_history: notificationHistoryDeleted.length,
    word_review_log: wordReviewLogDeleted.length,
    momentum_events: momentumEventsDeleted.length,
    bot_sessions: botSessionsDeleted.length,
    user_daily_request_counts: userDailyRequestCountsDeleted.length,
  };
}
