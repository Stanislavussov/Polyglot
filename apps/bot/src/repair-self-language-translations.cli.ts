/**
 * Delete translation rows stored in their entry's own language, on the database
 * this deploy is pointed at. Runs unattended from `deploy.yml` right after the
 * migrate + seed steps, so dev is repaired on a push to `develop` and production
 * on a merge to `master` — nobody has to hold a production connection string.
 *
 * Safe to run on every deploy: it only removes rows whose target language equals
 * their entry's source language, and once a database is repaired its predicate
 * matches nothing and it deletes nothing. Delete this file, its deploy step, and
 * `self-language-translation-repair.ts` once both environments have run it.
 */
import { closeDb, deleteSelfLanguageTranslations } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";

deleteSelfLanguageTranslations()
  .then((deleted) => {
    logger.info({ deleted }, "self-language translation repair complete");
  })
  .catch((err) => {
    logger.error({ err }, "self-language translation repair failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
