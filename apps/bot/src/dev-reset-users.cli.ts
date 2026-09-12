import { closeDb, formatUserResetIdentifier, parseUserResetIdentifiers, resetUsers } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";

// Hard stop against ever running this against production: the dev deploy is the
// only caller and it sets POLYGLOT_ENV explicitly on the `docker compose run`.
if (process.env.POLYGLOT_ENV !== "development") {
  logger.error(
    { env: process.env.POLYGLOT_ENV ?? null },
    "dev-reset-users refuses to run outside POLYGLOT_ENV=development",
  );
  process.exit(1);
}

const identifiers = parseUserResetIdentifiers(process.env.DEV_RESET_USERS);

if (identifiers.length === 0) {
  logger.info("DEV_RESET_USERS is empty, nothing to reset");
  process.exit(0);
}

resetUsers(identifiers)
  .then((result) => {
    logger.info(
      {
        deleted: result.deleted,
        notFound: result.notFound.map(formatUserResetIdentifier),
      },
      "dev user reset complete",
    );
  })
  .catch((err) => {
    logger.error({ err }, "dev user reset failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
