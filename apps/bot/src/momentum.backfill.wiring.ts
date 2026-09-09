/**
 * Momentum backfill entry point (Task 81, plan §3.9).
 *
 * A one-shot `docker compose run --rm --no-deps bot node apps/bot/dist/momentum.backfill.wiring.js`,
 * the same shape as the release-announcement CLI — there is no external app cron, and the
 * backfill is meant to be run once per environment rather than scheduled. It is safe to
 * re-run: the journal's deterministic dedupe keys make a second pass a no-op and the
 * snapshot is recomputed by replay, never lowered.
 */
import { closeDb, runMomentumBackfill } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import { baseEnvSchema, ConfigError, loadConfig } from "@polyglot/infra";

function loadBackfillConfig(): ReturnType<typeof loadConfig<typeof baseEnvSchema>> {
  try {
    return loadConfig(baseEnvSchema);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error({ issues: err.issues }, "Invalid environment variables");
      process.exit(1);
    }
    throw err;
  }
}

// `getDb()` reads DATABASE_URL off process.env itself; validating up front turns a missing
// variable into a readable startup failure instead of a lazy connection error mid-run.
loadBackfillConfig();

// The run's own summary is `momentum.backfill_finished` (§7.3), logged inside the adapter.
runMomentumBackfill()
  .catch((err) => {
    logger.error({ err }, "Momentum backfill failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
