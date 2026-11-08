/**
 * Daily goal-ladder close: ends the month for learners who never open `/progress`
 * and grants their reward. `/progress` itself closes lazily, so this tick is the
 * catch-up, not the only path.
 */
import { progressRepository } from "@polyglot/adapter-db";
import {
  errorFields,
  logEvent,
  monthBounds,
  monthKey,
  newTraceId,
  type ProgressService,
  previousMonth,
  runWithTrace,
} from "@polyglot/core";
import cron from "node-cron";
import { progressRewardDeferredCounter } from "../metrics.js";

let closeTask: cron.ScheduledTask | null = null;

/**
 * 10:30 UTC is just past midnight in UTC+14, the last zone to start a new month,
 * so on the 1st every learner's previous month has ended; the other days catch up.
 */
const PROGRESS_CLOSE_CRON = "30 10 * * *";

/** Local months start up to 14 h either side of the UTC one, so the scan window is widened by that much. */
const TZ_SPREAD_MS = 14 * 60 * 60 * 1000;

export async function runProgressClose(progressService: ProgressService, now = new Date()): Promise<void> {
  await runWithTrace({ traceId: newTraceId(), source: "cron", jobName: "progress_close" }, async () => {
    const month = previousMonth(monthKey(now, "UTC"));
    const { start, end } = monthBounds(month, "UTC");
    const userIds = await progressRepository.listUsersToClose(
      month,
      new Date(start.getTime() - TZ_SPREAD_MS),
      new Date(end.getTime() + TZ_SPREAD_MS),
    );
    let closed = 0;
    let granted = 0;
    for (const userId of userIds) {
      try {
        const result = await progressService.closeForUser(userId, "live", now);
        closed += result.closedMonths.length;
        granted += result.granted.length;
        progressRewardDeferredCounter.inc(result.deferredCycles.length);
      } catch (err) {
        // One user's failure must not stop everyone else's month from closing.
        logEvent("progress.close_failed", { userId, ...errorFields(err) }, "error");
      }
    }
    logEvent("progress.close_finished", { users: userIds.length, closed, granted });
  });
}

export function wireProgressClose(progressService: ProgressService): void {
  if (closeTask) return;
  closeTask = cron.schedule(PROGRESS_CLOSE_CRON, () => {
    void runProgressClose(progressService).catch((err) => {
      logEvent("progress.close_failed", errorFields(err), "error");
    });
  });
}

export function stopProgressClose(): void {
  closeTask?.stop();
  closeTask = null;
}
