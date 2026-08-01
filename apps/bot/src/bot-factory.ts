import { autoRetry } from "@grammyjs/auto-retry";
import { conversations, createConversation } from "@grammyjs/conversations";
import { sequentialize } from "@grammyjs/runner";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { type ApiClientOptions, Bot, type Middleware, type NextFunction, type StorageAdapter, session } from "grammy";
import { handleBotError } from "./bot-error-handler.js";
import { changesCommand } from "./commands/changes.js";
import { setBotCommands } from "./commands/commands.js";
import { startCommand } from "./commands/start.js";
import { createContainer } from "./container.js";
import { authMiddleware } from "./middlewares/auth.js";
import { conversationAuthPlugin } from "./middlewares/conversation-auth.js";
import { modeRouterMiddleware } from "./middlewares/mode-router.js";
import { updateMetricsMiddleware } from "./middlewares/update-metrics.js";
import { handleNotifLearnedCallback, handleNotifRevealCallback } from "./notifications/notification.callbacks.js";
import { handleDictionaryCommand } from "./scenes/dictionary.scene.js";
import { handleFlashcardCommand } from "./scenes/flashcard.scene.js";
import {
  handleAltMeaningCallback,
  handleEtymologyCallback,
  handleGrammarBreakdownCallback,
  handleGrammarDetailCallback,
  handleGrammarLangSelectCallback,
  handleRegenCallback,
  handleSaveCallback,
  handleSkipCallback,
} from "./scenes/helpers/card-actions.js";
import { handleClarifyPostCallback, handleTranslationClarificationCallback } from "./scenes/helpers/clarification.js";
import {
  handleDictAdd,
  handleDictAddMenu,
  handleDictClose,
  handleDictConfirmDelete,
  handleDictConfirmDeleteDictionary,
  handleDictCreate,
  handleDictDelete,
  handleDictDeleteDictionary,
  handleDictList,
  handleDictMove,
  handleDictMoveMenu,
  handleDictNoop,
  handleDictOpen,
  handleDictPage,
  handleDictRename,
  handleDictTranslate,
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
import { handleLangSelectCallback, handleOutOfSetCallback } from "./scenes/helpers/out-of-set.js";
import {
  handleSetBackCallback,
  handleSetCloseCallback,
  handleSetIfaceSelectCallback,
  handleSetInterfaceCallback,
  handleSetLearningCallback,
  handleSetLearnLevelCallback,
  handleSetLearnToggleCallback,
  handleSetNativeCallback,
  handleSetNativeSelectCallback,
  handleSetNotifBackCallback,
  handleSetNotifCallback,
  handleSetNotifContextCallback,
  handleSetNotifContextCancelCallback,
  handleSetNotifTimeCallback,
  handleSetNotifTimeSelectCallback,
  handleSetNotifToggleCallback,
  handleSetNotifTypeCallback,
  handleSetNotifTypeSelectCallback,
  handleSetNotifTzCallback,
  handleSetNotifTzSelectCallback,
} from "./scenes/helpers/settings.helper.js";
import {
  handleSrsClose,
  handleSrsQuit,
  handleSrsRate,
  handleSrsRestart,
  handleSrsReveal,
} from "./scenes/helpers/srs.helper.js";
import { handleStaleOnboardingCallback } from "./scenes/helpers/stale-onboarding.helper.js";
import { handleBuyPlanCallback, handleUpgradePromptCallback } from "./scenes/helpers/subscription.helper.js";
import {
  handleBackCallback,
  handleCancelCallback,
  handleCustomizeCallback,
  handlePreviewCallback,
  handleResetCallback,
  handleSaveTemplateCallback,
  handleToggleCallback,
} from "./scenes/helpers/template.helper.js";
import { handleMistypeCancelCallback, handleMistypeConfirmCallback } from "./scenes/helpers/translate-flow.js";
import {
  handleVideoBrowseCallback,
  handleVideoCancelCallback,
  handleVideoCloseCallback,
  handleVideoConfirmCallback,
  handleVideoListCallback,
  handleVideoNoopCallback,
  handleVideoSaveAllCallback,
  handleVideoSavePhraseCallback,
  handleVideosCommand,
} from "./scenes/helpers/video-vocabulary.helper.js";
import { handleMentorCommand } from "./scenes/mentor.scene.js";
import { onboarding } from "./scenes/onboarding.scene.js";
import { handleReportIssue } from "./scenes/report-issue.scene.js";
import { handleSettingsCommand } from "./scenes/settings.scene.js";
import { handleReviewCommand } from "./scenes/srs.scene.js";
import { handleTemplateCommand } from "./scenes/template.scene.js";
import { handleTranslateCommand } from "./scenes/translate.scene.js";
import type { BotContext, ConversationContext, SessionData } from "./types.js";
import { NOOP_CALLBACK } from "./utils/long-op.js";

export interface CreatePolyglotBotOptions {
  token: string;
  services?: BotContext["services"];
  sessionStorage?: StorageAdapter<SessionData>;
  apiRoot?: string;
  /**
   * Test seam: custom transport, passed through as a grammY client option so it
   * reaches every Api instance — including the fresh ones the conversations
   * plugin spawns for conversation contexts, which bypass bot.api transformers.
   */
  fetch?: NonNullable<ApiClientOptions["fetch"]>;
}

/**
 * Safety net for EVERY dialog, current and future (2026-07-06 incident): if a
 * conversation wait outlives this, the next update — even one the wait was
 * matching — halts the abandoned conversation with `{ next: true }`, so the
 * update is handled by downstream middleware instead of feeding a zombie
 * dialog. Per-wait `next: true` handles rejected updates immediately; this
 * timeout guarantees no dialog can capture a chat indefinitely even if a new
 * wait call forgets that option. Applied via `maxMillisecondsToWait` on every
 * `createConversation` below — set it on any conversation added later, too.
 */
const CONVERSATION_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Exits all active conversations when the user performs an external action
 * (bot command or non-conversation callback query). This prevents stale
 * conversations from blocking other commands and callbacks.
 */
async function exitActiveConversations(ctx: BotContext, next: NextFunction): Promise<void> {
  const active = ctx.conversation?.active?.();
  if (!active || Object.keys(active).length === 0) {
    return next();
  }

  if (ctx.message?.text?.startsWith("/")) {
    for (const id of Object.keys(active)) {
      await ctx.conversation.exit(id);
    }
    return next();
  }

  if (ctx.callbackQuery?.data) {
    const data = ctx.callbackQuery.data;
    const isConversationCallback =
      data.startsWith("report:") ||
      data.startsWith("onb:") ||
      data.startsWith("learn:") ||
      data.startsWith("lang:") ||
      data.startsWith("level:");
    if (!isConversationCallback) {
      for (const id of Object.keys(active)) {
        await ctx.conversation.exit(id);
      }
    }
  }

  return next();
}

export function createInitialSession(): SessionData {
  return {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    lastTranslation: undefined,
    lastInputType: undefined,
    savedWordId: undefined,
    translationMap: {},
    needsTranslateReminder: true,
    templateWizard: undefined,
    dictionary: undefined,
    dictionaryWizard: undefined,
    flashcard: undefined,
    srs: undefined,
    mentor: undefined,
    pendingDetectedLang: undefined,
    pendingWord: undefined,
    pendingDirection: undefined,
  };
}

export function createPolyglotBot(options: CreatePolyglotBotOptions): Bot<BotContext> {
  const clientOptions: ApiClientOptions | undefined =
    options.apiRoot || options.fetch
      ? {
          ...(options.apiRoot ? { apiRoot: options.apiRoot } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }
      : undefined;
  const bot = new Bot<BotContext>(options.token, {
    client: clientOptions,
  });

  // Telegram resilience (Fable T14). auto-retry backs off and retries on 429
  // flood-limits (so no update/send is lost); the throttler paces all outgoing
  // API calls under Telegram's global/per-chat limits so batch notification
  // sends (which share this Api instance) never hit the flood limit. Applied to
  // bot.api, which is also the Api passed to the notification scheduler.
  bot.api.config.use(autoRetry());
  bot.api.config.use(apiThrottler());

  bot.use(updateMetricsMiddleware);

  // Updates are processed concurrently by @grammyjs/runner; sequentialize
  // keeps per-chat order so two updates from the same user never race on
  // the Postgres-backed session. Must match the session key (chat id).
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  bot.use(
    session({
      initial: createInitialSession,
      storage: options.sessionStorage,
    }),
  );

  bot.use(conversations());

  const services = options.services ?? createContainer();
  bot.use((ctx, next) => {
    ctx.services = services;
    return next();
  });

  bot.use(authMiddleware);

  // Conversations run in a replayed context that the outer service-injection
  // middleware above never touches, so ctx.services is undefined inside them.
  // Re-inject the singleton container as a conversation plugin — it is a stable
  // reference, so re-setting it on every replay is deterministic. Without this,
  // the report conversation's auth/hydration plugin dereferences
  // ctx.services.identityRepository and crashes (Fable T24 regression).
  const injectServicesPlugin: Middleware<ConversationContext> = (ctx, next) => {
    ctx.services = services;
    return next();
  };
  bot.use(
    createConversation(onboarding, {
      plugins: [injectServicesPlugin],
      maxMillisecondsToWait: CONVERSATION_WAIT_TIMEOUT_MS,
    }),
  );
  bot.use(
    createConversation(handleReportIssue, {
      plugins: [injectServicesPlugin, conversationAuthPlugin()],
      maxMillisecondsToWait: CONVERSATION_WAIT_TIMEOUT_MS,
    }),
  );
  bot.use(exitActiveConversations);

  bot.command("start", startCommand);
  bot.command("translate", handleTranslateCommand);
  bot.command("mentor", handleMentorCommand);
  bot.command("template", handleTemplateCommand);
  bot.command("dictionary", handleDictionaryCommand);
  bot.command("flashcard", handleFlashcardCommand);
  bot.command("review", handleReviewCommand);
  bot.command("settings", handleSettingsCommand);
  bot.command("changes", changesCommand);
  bot.command("videos", handleVideosCommand);
  bot.command("report", async (ctx) => {
    await ctx.conversation.enter("handleReportIssue");
  });

  // Inert loading button shown while a long operation runs.
  bot.callbackQuery(NOOP_CALLBACK, (ctx) => ctx.answerCallbackQuery());

  // Recover onboarding buttons whose conversation already ended (wait timeout /
  // force-exit). A live onboarding consumes these first; this only fires for a
  // dead dialog, where the tap would otherwise match nothing and hang forever.
  bot.callbackQuery(/^(?:lang|learn|onb|level):/, handleStaleOnboardingCallback);

  bot.callbackQuery("set:native", handleSetNativeCallback);
  bot.callbackQuery(/^set:native:/, handleSetNativeSelectCallback);
  bot.callbackQuery("set:learning", handleSetLearningCallback);
  bot.callbackQuery(/^set:learn:lvl:/, handleSetLearnLevelCallback);
  bot.callbackQuery(/^set:learn:/, handleSetLearnToggleCallback);
  bot.callbackQuery("set:interface", handleSetInterfaceCallback);
  bot.callbackQuery(/^set:iface:/, handleSetIfaceSelectCallback);
  bot.callbackQuery("set:notif", handleSetNotifCallback);
  bot.callbackQuery("set:notif:toggle", handleSetNotifToggleCallback);
  bot.callbackQuery("set:notif:time", handleSetNotifTimeCallback);
  bot.callbackQuery(/^set:notif:time:/, handleSetNotifTimeSelectCallback);
  bot.callbackQuery("set:notif:type", handleSetNotifTypeCallback);
  bot.callbackQuery(/^set:notif:type:/, handleSetNotifTypeSelectCallback);
  bot.callbackQuery("set:notif:tz", handleSetNotifTzCallback);
  bot.callbackQuery(/^set:notif:tz:/, handleSetNotifTzSelectCallback);
  bot.callbackQuery("set:notif:context", handleSetNotifContextCallback);
  bot.callbackQuery("set:notif:context:cancel", handleSetNotifContextCancelCallback);
  bot.callbackQuery("set:notif:back", handleSetNotifBackCallback);
  bot.callbackQuery("set:back", handleSetBackCallback);
  bot.callbackQuery("set:close", handleSetCloseCallback);

  bot.callbackQuery(/^notif:reveal:/, handleNotifRevealCallback);
  bot.callbackQuery(/^notif:learned:/, handleNotifLearnedCallback);

  bot.callbackQuery(/^tr:save:/, handleSaveCallback);
  bot.callbackQuery(/^tr:skip:/, handleSkipCallback);
  bot.callbackQuery(/^tr:regen:/, handleRegenCallback);
  bot.callbackQuery(/^tr:clarifypost:/, handleClarifyPostCallback);
  bot.callbackQuery(/^tr:altmeaning:/, handleAltMeaningCallback);
  bot.callbackQuery(/^tr:gramdetail:/, handleGrammarDetailCallback);
  bot.callbackQuery(/^tr:gramlang:/, handleGrammarLangSelectCallback);
  bot.callbackQuery(/^tr:grammar:/, handleGrammarBreakdownCallback);
  bot.callbackQuery(/^tr:etymology:/, handleEtymologyCallback);
  bot.callbackQuery("tr:mistype:confirm", handleMistypeConfirmCallback);

  bot.callbackQuery("plan:upgrade", handleUpgradePromptCallback);
  bot.callbackQuery(/^plan:buy:/, handleBuyPlanCallback);
  bot.callbackQuery("tr:mistype:cancel", handleMistypeCancelCallback);
  bot.callbackQuery(/^tr:langselect:/, handleLangSelectCallback);
  bot.callbackQuery(/^tr:oos:/, handleOutOfSetCallback);
  bot.callbackQuery(/^tr:clarify:/, handleTranslationClarificationCallback);

  bot.callbackQuery("fc:start", handleFcStart);
  bot.callbackQuery("fc:reveal", handleFcReveal);
  bot.callbackQuery("fc:next", handleFcNext);
  bot.callbackQuery("fc:done", handleFcDone);
  bot.callbackQuery("fc:restart", handleFcRestart);
  bot.callbackQuery("fc:quit", handleFcQuit);
  bot.callbackQuery("fc:close", handleFcClose);

  bot.callbackQuery("srs:reveal", handleSrsReveal);
  bot.callbackQuery(/^srs:rate:(again|hard|good|easy)$/, handleSrsRate);
  bot.callbackQuery("srs:restart", handleSrsRestart);
  bot.callbackQuery("srs:quit", handleSrsQuit);
  bot.callbackQuery("srs:close", handleSrsClose);

  bot.callbackQuery(/^dict:page:/, handleDictPage);
  bot.callbackQuery(/^dict:view:/, handleDictView);
  bot.callbackQuery(/^dict:delete:/, handleDictDelete);
  bot.callbackQuery(/^dict:confirm-delete:/, handleDictConfirmDelete);
  bot.callbackQuery("dict:list", handleDictList);
  bot.callbackQuery(/^dict:open:/, handleDictOpen);
  bot.callbackQuery("dict:create", handleDictCreate);
  bot.callbackQuery(/^dict:rename:/, handleDictRename);
  bot.callbackQuery(/^dict:delete-dict:/, handleDictDeleteDictionary);
  bot.callbackQuery(/^dict:confirm-delete-dict:/, handleDictConfirmDeleteDictionary);
  bot.callbackQuery(/^dict:add-menu:/, handleDictAddMenu);
  bot.callbackQuery(/^dict:move-menu:/, handleDictMoveMenu);
  bot.callbackQuery(/^dict:add:/, handleDictAdd);
  bot.callbackQuery(/^dict:move:/, handleDictMove);
  bot.callbackQuery(/^dict:translate:/, handleDictTranslate);
  bot.callbackQuery("dict:close", handleDictClose);
  bot.callbackQuery("dict:noop", handleDictNoop);

  bot.callbackQuery(/^vid:confirm:/, handleVideoConfirmCallback);
  bot.callbackQuery(/^vid:cancel:/, handleVideoCancelCallback);
  bot.callbackQuery(/^vid:browse:/, handleVideoBrowseCallback);
  bot.callbackQuery(/^vid:save:/, handleVideoSavePhraseCallback);
  bot.callbackQuery(/^vid:saveall:/, handleVideoSaveAllCallback);
  bot.callbackQuery(/^vid:list:/, handleVideoListCallback);
  bot.callbackQuery("vid:close", handleVideoCloseCallback);
  bot.callbackQuery(/^vid:noop:/, handleVideoNoopCallback);

  bot.callbackQuery("tpl:customize", handleCustomizeCallback);
  bot.callbackQuery(/^tpl:toggle:/, handleToggleCallback);
  bot.callbackQuery("tpl:preview", handlePreviewCallback);
  bot.callbackQuery("tpl:save", handleSaveTemplateCallback);
  bot.callbackQuery("tpl:cancel", handleCancelCallback);
  bot.callbackQuery("tpl:reset", handleResetCallback);
  bot.callbackQuery("tpl:back", handleBackCallback);

  bot.use(modeRouterMiddleware);

  bot.catch(handleBotError);

  return bot;
}

export async function installBotCommands(bot: Bot<BotContext>): Promise<void> {
  await setBotCommands(bot.api);
}
