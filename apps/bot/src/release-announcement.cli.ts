import { closeDb } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import { botEnvSchema, ConfigError, loadConfig } from "@polyglot/infra";
import { Bot } from "grammy";
import { sendReleaseAnnouncement } from "./release-announcement.js";

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
const bot = new Bot(config.BOT_TOKEN);

sendReleaseAnnouncement(process.env, bot.api)
  .catch((err) => {
    logger.error({ err }, "Release announcement CLI failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
