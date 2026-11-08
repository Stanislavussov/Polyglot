/**
 * Close the goal ladder's in-window months for everyone who learned in them, on
 * the database this deploy points at. Runs unattended from `deploy.yml` after the
 * migrate + seed steps; a re-run only closes months still missing from the ledger
 * and never grants a reward. Delete this file, its deploy step and
 * `progress-backfill.ts` on 2027-03-01 or one week after the first master deploy
 * that carried it, whichever is later.
 */
import { closeDb, runProgressBackfill } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";

runProgressBackfill()
  .then((result) => {
    logger.info(result, "progress months backfill complete");
  })
  .catch((err) => {
    logger.error({ err }, "progress months backfill failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
