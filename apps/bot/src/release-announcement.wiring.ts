/**
 * Release-announcement worker.
 *
 * Nothing is announced on deploy: releases go out several times a day and a
 * reader must not get several messages a day. An editor picks the moment in the
 * admin panel, which has no bot token by design — it writes a job row, and this
 * worker, inside the one service that talks to Telegram, carries it out.
 */
import { isAudienceGroup, releaseAnnouncementJobRepository } from "@polyglot/adapter-db";
import type { AudienceGroup } from "@polyglot/core";
import { errorFields, logEvent, newTraceId, runWithTrace } from "@polyglot/core";
import { announceNotes, type TelegramMessenger } from "./release-announcement.js";

/** A person is waiting on the panel for this, so the queue is checked often. */
const POLL_INTERVAL_MS = 10_000;

let pollTimer: NodeJS.Timeout | null = null;
let draining = false;

async function runJob(messenger: TelegramMessenger, job: Awaited<ReturnType<typeof claimNext>>): Promise<void> {
  if (!job) return;

  await runWithTrace({ traceId: newTraceId(), source: "cron", jobName: "release_announcement" }, async () => {
    try {
      const result = await announceNotes(
        {
          notes: job.notes,
          audienceGroups: job.audienceGroups.filter((group): group is AudienceGroup => isAudienceGroup(group)),
          releaseId: `job:${job.id}`,
        },
        messenger,
      );
      await releaseAnnouncementJobRepository.finish(job.id, "sent", {
        attempted: result.attempted,
        delivered: result.delivered,
        failed: result.failed,
      });
      logEvent("release.announcement_sent", { jobId: job.id, ...result });
    } catch (err) {
      // The job is marked failed rather than left claimed: a row stuck in
      // `sending` would be invisible to the panel and to the next tick alike.
      await releaseAnnouncementJobRepository.finish(job.id, "failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      logEvent("release.announcement_failed", { jobId: job.id, ...errorFields(err) }, "error");
    }
  });
}

const claimNext = () => releaseAnnouncementJobRepository.claimNext();

/**
 * Carry out every queued announcement, one at a time. Exported so a test can
 * drive a whole tick without waiting on the interval.
 */
export async function runPendingAnnouncements(messenger: TelegramMessenger): Promise<void> {
  // A send can outlive the tick interval; overlapping drains would claim and
  // deliver in parallel with no gain, so a slow run simply holds the next tick.
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = await claimNext();
      if (!job) return;
      await runJob(messenger, job);
    }
  } catch (err) {
    logEvent("release.announcement_poll_failed", errorFields(err), "error");
  } finally {
    draining = false;
  }
}

/** Start polling for announcements queued from the panel. Idempotent. */
export function wireReleaseAnnouncements(messenger: TelegramMessenger): void {
  if (pollTimer) {
    logEvent("release.announcement_poll_duplicate_ignored", {}, "warn");
    return;
  }

  pollTimer = setInterval(() => {
    void runPendingAnnouncements(messenger);
  }, POLL_INTERVAL_MS);
  // Never hold the process open for a queue that is almost always empty.
  pollTimer.unref();
  logEvent("release.announcement_poll_started", { intervalMs: POLL_INTERVAL_MS });
}

export function stopReleaseAnnouncements(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logEvent("release.announcement_poll_stopped", {});
  }
}
