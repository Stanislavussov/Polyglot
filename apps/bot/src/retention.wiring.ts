/**
 * Telemetry retention wiring (Fable T25/E5).
 *
 * None of the append-only telemetry/log tables had a retention horizon, so they
 * grew forever. `runTelemetryRetention` prunes rows older than the horizon; this
 * module schedules it as a single in-process daily cron job, mirroring the
 * notification scheduler pattern (`@polyglot/adapter-notifications`). Running it
 * in-process keeps the deployment a single long-lived container — there is no
 * external cron in the app-deploy pipeline (the release-announcement CLI is a
 * one-shot `docker compose run`, not a recurring job).
 */
import { runTelemetryRetention } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import cron from "node-cron";

/** Internal state for the running cron task. */
let retentionTask: cron.ScheduledTask | null = null;

/** Daily at 03:15 UTC — off-peak, clear of the scheduler's midnight boundary work. */
const RETENTION_CRON = "15 3 * * *";

async function runRetentionSweep(): Promise<void> {
  try {
    const deleted = await runTelemetryRetention();
    logger.info({ deleted }, "Telemetry retention sweep complete");
  } catch (err) {
    // Never let a failed sweep crash the process — it retries on the next tick.
    logger.error({ err }, "Telemetry retention sweep failed — continuing");
  }
}

/**
 * Start the daily telemetry-retention cron job. Idempotent: a duplicate call
 * while a job is already scheduled is ignored.
 */
export function wireTelemetryRetention(): void {
  if (retentionTask) {
    logger.warn({}, "Telemetry retention already scheduled — ignoring duplicate call");
    return;
  }

  retentionTask = cron.schedule(RETENTION_CRON, () => {
    void runRetentionSweep();
  });
  logger.info({ schedule: RETENTION_CRON }, "Telemetry retention scheduled");
}

/** Stop the retention cron job gracefully. */
export function stopTelemetryRetention(): void {
  if (retentionTask) {
    retentionTask.stop();
    retentionTask = null;
    logger.info({}, "Telemetry retention scheduler stopped");
  }
}
