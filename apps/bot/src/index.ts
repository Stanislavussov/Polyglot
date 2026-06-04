import { closeDb, getAllLangs, loadLanguageCache } from "@polyglot/adapter-db";
import { stopScheduler } from "@polyglot/adapter-notifications";
import { initLanguageRegistry, logger, setLogger } from "@polyglot/core";
import { loadConfig } from "@polyglot/infra";
import { createPolyglotBot, installBotCommands } from "./bot-factory.js";
import { startMetricsServer } from "./metrics.js";
import { wireNotificationScheduler } from "./notifications/notification.wiring.js";
import { createPostgresSessionStorage } from "./session-storage.js";

const config = loadConfig();

setLogger(logger);

const bot = createPolyglotBot({
  token: config.BOT_TOKEN,
  sessionStorage: createPostgresSessionStorage(),
});

function setupGracefulShutdown(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Received shutdown signal");
    stopScheduler();
    await bot.stop();
    await closeDb();
    logger.info("Bot stopped, scheduler stopped, and DB connection closed");
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function main(): Promise<void> {
  setupGracefulShutdown();

  await loadLanguageCache();
  const allLangs = getAllLangs();
  initLanguageRegistry(allLangs);
  logger.info({ count: allLangs.length }, "Language registry loaded from DB");

  await installBotCommands(bot);

  wireNotificationScheduler(bot.api);
  startMetricsServer();

  logger.info({ sessionStorage: "postgres", languageCacheReady: true, pollingMode: "long-polling" }, "Starting bot");
  await bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username, id: botInfo.id }, "Bot started");
    },
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start bot");
  process.exit(1);
});
