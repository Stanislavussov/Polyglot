/**
 * Restore native translations that background enrichment deleted, on the database
 * this deploy is pointed at. Runs unattended from `deploy.yml` right after the
 * migrate + seed steps, so dev is repaired on a push to `develop` and production
 * on a merge to `master` — nobody has to hold a production connection string.
 *
 * Safe to run on every deploy: it only inserts rows that are missing, and once a
 * database is repaired its query matches nothing and it writes nothing. Delete
 * this file, its deploy step, and `native-translation-repair.ts` once both
 * environments have run it.
 */
import { closeDb, findRepairableNativeTranslations, restoreNativeTranslations } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";

findRepairableNativeTranslations()
  .then(async (repairable) => {
    if (repairable.length === 0) {
      logger.info("native translation repair: nothing to restore");
      return;
    }
    const restored = await restoreNativeTranslations(repairable);
    logger.info(
      {
        found: repairable.length,
        restored,
        bySource: repairable.reduce<Record<string, number>>((acc, row) => {
          acc[row.source] = (acc[row.source] ?? 0) + 1;
          return acc;
        }, {}),
      },
      "native translation repair complete",
    );
  })
  .catch((err) => {
    logger.error({ err }, "native translation repair failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
