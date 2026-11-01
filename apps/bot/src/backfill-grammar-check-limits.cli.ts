/**
 * Give every plan that predates the grammar check its daily allowance, on the
 * database this deploy is pointed at. Runs unattended from `deploy.yml` right after
 * the migrate + seed steps, before the new containers start, so the bot never
 * serves a plan whose limit is still the "never configured" sentinel.
 *
 * Safe to run on every deploy: it only rewrites rows still holding that sentinel,
 * so once a database is filled it writes nothing, and it never touches a limit an
 * admin saved. Delete this file, its deploy step and `grammar-check-limit-backfill.ts`
 * once both environments have run it.
 */
import { backfillGrammarCheckLimits, closeDb } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";

backfillGrammarCheckLimits()
  .then((filled) => {
    logger.info(
      { filled },
      filled.length === 0 ? "grammar-check limit backfill: nothing to fill" : "grammar-check limit backfill complete",
    );
  })
  .catch((err) => {
    logger.error({ err }, "grammar-check limit backfill failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
