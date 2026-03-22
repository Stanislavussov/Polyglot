import { Bot, session } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { loadConfig } from "@polyglot/infra";
import { logger } from "@polyglot/infra";
import { closeDb, loadLanguageCache, getAllLangs } from "@polyglot/adapter-db";
import { initLanguageRegistry } from "@polyglot/core";
import { authMiddleware } from "./middlewares/auth.js";
import { modeRouterMiddleware } from "./middlewares/mode-router.js";
import { onboarding } from "./scenes/onboarding.scene.js";
import { handleTranslateCommand } from "./scenes/translate.scene.js";
import { handleSaveCallback, handleSkipCallback } from "./scenes/helpers/translate-mode.helper.js";
import { startCommand } from "./commands/start.js";
import type { BotContext, SessionData } from "./types.js";

// ── Load & validate environment ──
const config = loadConfig();

// ── Create bot instance ──
const bot = new Bot<BotContext>(config.BOT_TOKEN);

// ── Register middleware ──

// Session middleware — stores active mode and pending translations
bot.use(
  session({
    initial: (): SessionData => ({
      activeMode: "idle",
      pendingTranslation: undefined,
      pendingCardMsgId: undefined,
    }),
  }),
);

// Conversations plugin (must be before createConversation)
bot.use(conversations());

// Auth middleware — resolves/creates user, attaches to ctx.user
// Must be before createConversation so ctx.user is available inside conversations
bot.use(authMiddleware);

// Register conversation handlers (onboarding still uses conversations)
bot.use(createConversation(onboarding));

// ── Register commands ──
bot.command("start", startCommand);
bot.command("translate", handleTranslateCommand);

// ── Register callback handlers for translate mode ──
bot.callbackQuery("tr:save", handleSaveCallback);
bot.callbackQuery("tr:skip", handleSkipCallback);

// ── Mode router — processes plain text based on active mode ──
// Must be after commands so commands take priority
bot.use(modeRouterMiddleware);

// ── Set bot commands list ──
async function setBotCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Onboarding or main menu" },
    { command: "translate", description: "Translate a word or phrase" },
    { command: "dictionary", description: "Personal dictionary" },
    { command: "settings", description: "Language, notifications, timezone" },
  ]);
  logger.info("Bot commands list set");
}

// ── Graceful shutdown ──
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    bot.stop();
    await closeDb();
    logger.info("Bot stopped and DB connection closed");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ── Error handling ──
bot.catch((err) => {
  const ctx = err.ctx;
  const userId = ctx.from?.id;
  const command = ctx.message?.text?.split(" ")[0] ?? "unknown";
  logger.error(
    {
      error:
        err.error instanceof Error ? err.error.message : String(err.error),
      userId,
      command,
    },
    "Bot error",
  );
});

// ── Start bot ──
async function main(): Promise<void> {
  setupGracefulShutdown();

  // Load languages from DB into cache → init core registry
  await loadLanguageCache();
  const allLangs = getAllLangs();
  initLanguageRegistry(allLangs);
  logger.info({ count: allLangs.length }, "Language registry loaded from DB");

  await setBotCommands();

  logger.info("Starting bot in long-polling mode...");
  bot.start({
    onStart: (botInfo) => {
      logger.info(
        { username: botInfo.username, id: botInfo.id },
        "Bot started",
      );
    },
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start bot");
  process.exit(1);
});
