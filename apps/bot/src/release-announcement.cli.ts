import { closeDb } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import { loadConfig } from "@polyglot/infra";
import { Bot } from "grammy";
import { sendReleaseAnnouncement } from "./release-announcement.js";

const config = loadConfig();
const bot = new Bot(config.BOT_TOKEN);

sendReleaseAnnouncement(process.env, bot.api)
  .catch((err) => {
    logger.error({ err }, "Release announcement CLI failed");
    process.exitCode = 1;
  })
  .finally(closeDb);
