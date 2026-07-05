import type { Server } from "node:http";
import { type RunnerHandle, run } from "@grammyjs/runner";
import { closeDb, getAllLangs, loadLanguageCache } from "@polyglot/adapter-db";
import { stopScheduler } from "@polyglot/adapter-notifications";
import { logger, setLogger } from "@polyglot/core";
import { botEnvSchema, ConfigError, loadConfig } from "@polyglot/infra";
import { createPolyglotBot, installBotCommands } from "./bot-factory.js";
import { closeMetricsServer, startMetricsServer } from "./metrics.js";
import { wireNotificationScheduler } from "./notifications/notification.wiring.js";
import { stopTelemetryRetention, wireTelemetryRetention } from "./retention.wiring.js";
import { createPostgresSessionStorage } from "./session-storage.js";
import { createGracefulShutdown } from "./shutdown.js";

function loadBotConfig(): ReturnType<typeof loadConfig<typeof botEnvSchema>> {
  try {
    return loadConfig(botEnvSchema);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error({ issues: err.issues }, "Invalid environment variables");
      process.exit(1);
    }
    throw err;
  }
}

const config = loadBotConfig();

setLogger(logger);

const bot = createPolyglotBot({
  token: config.BOT_TOKEN,
  sessionStorage: createPostgresSessionStorage(),
});

let runner: RunnerHandle | null = null;
let metricsServer: Server | null = null;

/**
 * Hard deadline for graceful shutdown (B12). If cleanup outruns this the process
 * force-exits rather than lingering until the orchestrator sends SIGKILL.
 */
const SHUTDOWN_DEADLINE_MS = 10_000;

function setupGracefulShutdown(): void {
  const shutdown = createGracefulShutdown({
    steps: [
      { name: "scheduler", run: () => stopScheduler() },
      { name: "telemetryRetention", run: () => stopTelemetryRetention() },
      {
        name: "runner",
        run: async () => {
          if (runner?.isRunning()) await runner.stop();
        },
      },
      { name: "metricsServer", run: () => closeMetricsServer(metricsServer) },
      { name: "db", run: () => closeDb() },
    ],
    deadlineMs: SHUTDOWN_DEADLINE_MS,
    logger,
    forceExit: (code) => process.exit(code),
  });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function main(): Promise<void> {
  setupGracefulShutdown();

  // Loads the `languages` table straight into the core registry (the single
  // source of truth); the getters delegate to it (Fable T21/A3).
  await loadLanguageCache();
  logger.info({ count: getAllLangs().length }, "Language registry loaded from DB");

  await installBotCommands(bot);

  await wireNotificationScheduler(bot.api);
  wireTelemetryRetention();
  metricsServer = startMetricsServer();

  logger.info({ sessionStorage: "postgres", languageCacheReady: true, pollingMode: "long-polling" }, "Starting bot");
  await bot.init();
  runner = run(bot);
  // botUsername (not the redacted `username` PII path): this is the bot's own handle.
  logger.info({ botUsername: bot.botInfo.username, id: bot.botInfo.id }, "Bot started (concurrent runner)");
}

main().catch((err) => {
  logger.error({ err }, "Failed to start bot");
  process.exit(1);
});
