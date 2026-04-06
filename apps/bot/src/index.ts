import { conversations, createConversation } from "@grammyjs/conversations";
import { closeDb, getAllLangs, loadLanguageCache } from "@polyglot/adapter-db";
import { stopScheduler } from "@polyglot/adapter-notifications";
import { initLanguageRegistry, setLogger } from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import { Bot, session } from "grammy";
import { setBotCommands } from "./commands/commands.js";
import { startCommand } from "./commands/start.js";
import { authMiddleware } from "./middlewares/auth.js";
import { modeRouterMiddleware } from "./middlewares/mode-router.js";
import { handleNotifOpenCallback, handleNotifSkipCallback } from "./notifications/notification.callbacks.js";
import { wireNotificationScheduler } from "./notifications/notification.wiring.js";
import { handleDictionaryCommand } from "./scenes/dictionary.scene.js";
import { handleFlashcardCommand } from "./scenes/flashcard.scene.js";
import {
  handleDictClose,
  handleDictConfirmDelete,
  handleDictDelete,
  handleDictNoop,
  handleDictPage,
  handleDictView,
} from "./scenes/helpers/dictionary.helper.js";
import {
  handleFcClose,
  handleFcDone,
  handleFcNext,
  handleFcQuit,
  handleFcRestart,
  handleFcReveal,
  handleFcStart,
} from "./scenes/helpers/flashcard.helper.js";
import {
  handleSetBackCallback,
  handleSetCloseCallback,
  handleSetIfaceSelectCallback,
  handleSetInterfaceCallback,
  handleSetLearningCallback,
  handleSetLearnToggleCallback,
  handleSetNativeCallback,
  handleSetNativeSelectCallback,
  handleSetNotifToggleCallback,
  handleSetNotifTimeCallback,
  handleSetNotifTimeSelectCallback,
  handleSetNotifTypeCallback,
  handleSetNotifTypeSelectCallback,
  handleSetNotifTzCallback,
  handleSetNotifTzSelectCallback,
} from "./scenes/helpers/settings.helper.js";
import {
  handleBackCallback,
  handleCancelCallback,
  handleCustomizeCallback,
  handlePreviewCallback,
  handleResetCallback,
  handleSaveTemplateCallback,
  handleToggleCallback,
} from "./scenes/helpers/template.helper.js";
import {
  handleRegenCallback,
  handleSaveCallback,
  handleSkipCallback,
  handleSourceLangCallback,
} from "./scenes/helpers/translate-mode.helper.js";
import { onboarding } from "./scenes/onboarding.scene.js";
import { handleSettingsCommand } from "./scenes/settings.scene.js";
import { handleTemplateCommand } from "./scenes/template.scene.js";
import { handleTranslateCommand } from "./scenes/translate.scene.js";
import type { BotContext, SessionData } from "./types.js";
import { startMetricsServer, telegramMessagesCounter } from "./metrics.js";

// ── Load & validate environment ──
const config = loadConfig();

// ── Inject pino logger into core (clean-arch bridge) ──
setLogger(logger);

// ── Create bot instance ──
const bot = new Bot<BotContext>(config.BOT_TOKEN);

// ── Register middleware ──

// Session middleware — stores active mode and pending translations
bot.use(
  session({
    initial: (): SessionData => ({
      activeMode: "translate",
      pendingTranslation: undefined,
      pendingCardMsgId: undefined,
      nextSourceLang: null,
      lastTranslation: undefined,
      lastInputType: undefined,
      savedWordId: undefined,
      needsTranslateReminder: true,
      templateWizard: undefined,
      dictionary: undefined,
      flashcard: undefined,
    }),
  }),
);

// Metrics middleware — count incoming messages
bot.use((ctx, next) => {
  const type = ctx.callbackQuery ? "callback" : ctx.message ? "message" : "other";
  telegramMessagesCounter.inc({ type });
  return next();
});

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
bot.command("template", handleTemplateCommand);
bot.command("dictionary", handleDictionaryCommand);
bot.command("flashcard", handleFlashcardCommand);
bot.command("settings", handleSettingsCommand);

// ── Register callback handlers for settings (Task 37) ──
bot.callbackQuery("set:native", handleSetNativeCallback);
bot.callbackQuery(/^set:native:/, handleSetNativeSelectCallback);
bot.callbackQuery("set:learning", handleSetLearningCallback);
bot.callbackQuery(/^set:learn:/, handleSetLearnToggleCallback);
bot.callbackQuery("set:interface", handleSetInterfaceCallback);
bot.callbackQuery(/^set:iface:/, handleSetIfaceSelectCallback);
bot.callbackQuery("set:notif:toggle", handleSetNotifToggleCallback);
bot.callbackQuery("set:notif:time", handleSetNotifTimeCallback);
bot.callbackQuery(/^set:notif:time:/, handleSetNotifTimeSelectCallback);
bot.callbackQuery("set:notif:type", handleSetNotifTypeCallback);
bot.callbackQuery(/^set:notif:type:/, handleSetNotifTypeSelectCallback);
bot.callbackQuery("set:notif:tz", handleSetNotifTzCallback);
bot.callbackQuery(/^set:notif:tz:/, handleSetNotifTzSelectCallback);
bot.callbackQuery("set:back", handleSetBackCallback);
bot.callbackQuery("set:close", handleSetCloseCallback);

// ── Register callback handlers for notifications (Task 41) ──
bot.callbackQuery("notif:open", handleNotifOpenCallback);
bot.callbackQuery("notif:skip", handleNotifSkipCallback);

// ── Register callback handlers for translate mode ──
bot.callbackQuery("tr:save", handleSaveCallback);
bot.callbackQuery("tr:skip", handleSkipCallback);
bot.callbackQuery(/^tr:regen:/, handleRegenCallback);
bot.callbackQuery(/^tr:srclang:/, handleSourceLangCallback);

// ── Register callback handlers for flashcard (Task 33) ──
bot.callbackQuery("fc:start", handleFcStart);
bot.callbackQuery("fc:reveal", handleFcReveal);
bot.callbackQuery("fc:next", handleFcNext);
bot.callbackQuery("fc:done", handleFcDone);
bot.callbackQuery("fc:restart", handleFcRestart);
bot.callbackQuery("fc:quit", handleFcQuit);
bot.callbackQuery("fc:close", handleFcClose);

// ── Register callback handlers for dictionary browse (Task 40) ──
bot.callbackQuery(/^dict:page:/, handleDictPage);
bot.callbackQuery(/^dict:view:/, handleDictView);
bot.callbackQuery(/^dict:delete:/, handleDictDelete);
bot.callbackQuery(/^dict:confirm-delete:/, handleDictConfirmDelete);
bot.callbackQuery("dict:close", handleDictClose);
bot.callbackQuery("dict:noop", handleDictNoop);

// ── Register callback handlers for template wizard (Task 32) ──
bot.callbackQuery("tpl:customize", handleCustomizeCallback);
bot.callbackQuery(/^tpl:toggle:/, handleToggleCallback);
bot.callbackQuery("tpl:preview", handlePreviewCallback);
bot.callbackQuery("tpl:save", handleSaveTemplateCallback);
bot.callbackQuery("tpl:cancel", handleCancelCallback);
bot.callbackQuery("tpl:reset", handleResetCallback);
bot.callbackQuery("tpl:back", handleBackCallback);

// ── Mode router — processes plain text based on active mode ──
// Must be after commands so commands take priority
bot.use(modeRouterMiddleware);

// ── Set bot commands list (localized per-language + default fallback) ──
// Extracted to apps/bot/src/commands/commands.ts

// ── Graceful shutdown ──
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal");
    stopScheduler();
    bot.stop();
    await closeDb();
    logger.info("Bot stopped, scheduler stopped, and DB connection closed");
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
      error: err.error instanceof Error ? err.error.message : String(err.error),
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

  await setBotCommands(bot.api);

  // Start notification scheduler (Task 41) — must be after language cache is loaded
  wireNotificationScheduler(bot.api);

  startMetricsServer();

  logger.info("Starting bot in long-polling mode...");
  bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username, id: botInfo.id }, "Bot started");
    },
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start bot");
  process.exit(1);
});
