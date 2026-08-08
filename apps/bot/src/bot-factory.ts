import { autoRetry } from "@grammyjs/auto-retry";
import { conversations, createConversation } from "@grammyjs/conversations";
import { sequentialize } from "@grammyjs/runner";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import {
  type ApiClientOptions,
  Bot,
  type Middleware,
  type MiddlewareFn,
  type NextFunction,
  type StorageAdapter,
  session,
} from "grammy";
import { handleBotError } from "./bot-error-handler.js";
import { changesCommand } from "./commands/changes.js";
import { setBotCommands } from "./commands/commands.js";
import { startCommand } from "./commands/start.js";
import { createContainer } from "./container.js";
import { authMiddleware } from "./middlewares/auth.js";
import { conversationAuthPlugin } from "./middlewares/conversation-auth.js";
import { mainKeyboardMiddleware } from "./middlewares/main-keyboard.js";
import { modeRouterMiddleware } from "./middlewares/mode-router.js";
import { updateMetricsMiddleware } from "./middlewares/update-metrics.js";
import { handleNotifLearnedCallback, handleNotifRevealCallback } from "./notifications/notification.callbacks.js";
import { createApiLogTransformer } from "./observability/api-log.js";
import { handlerName, withHandlerLog } from "./observability/handler-log.js";
import { updateTraceMiddleware } from "./observability/update-trace.middleware.js";
import { handleNudgeCardCallback, NUDGE_CALLBACK_PATTERN } from "./onboarding/activation-nudge.callbacks.js";
import {
  handleLegacyOnboardingCallback,
  handleOnboardingCallback,
  LEGACY_ONBOARDING_CALLBACK_PATTERN,
  ONBOARDING_CALLBACK_PATTERN,
  onboardingTextMiddleware,
} from "./onboarding/onboarding-handlers.js";
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
import {
  handleLangSelectCallback,
  handleOutOfSetCallback,
  handleSrcLangOverrideCallback,
} from "./scenes/helpers/out-of-set.js";
import { handleRetryCallback } from "./scenes/helpers/retry.helper.js";
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
  handleVideoTryCallback,
  VIDEO_TRY_PATTERN,
} from "./scenes/helpers/video-vocabulary.helper.js";
import { handleMentorCommand } from "./scenes/mentor.scene.js";
import { handleReportIssue } from "./scenes/report-issue.scene.js";
import { handleSettingsCommand } from "./scenes/settings.scene.js";
import { handleReviewCommand } from "./scenes/srs.scene.js";
import { handleTemplateCommand } from "./scenes/template.scene.js";
import { handleTranslateCommand } from "./scenes/translate.scene.js";
import type { BotContext, ConversationContext, SessionData } from "./types.js";
import { NOOP_CALLBACK } from "./utils/long-op.js";
import { mainMenuLabels, matchMainMenuAction } from "./utils/main-menu.js";
import { RETRY_CALLBACK } from "./utils/retry-action.js";

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

  // Main-menu keyboard taps count as external actions too: they are the commands
  // /dictionary, /flashcard and /videos wearing a button, so they must abandon an
  // open dialog exactly like a typed command does.
  const text = ctx.message?.text;
  if (text?.startsWith("/") || (text !== undefined && matchMainMenuAction(text) !== undefined)) {
    for (const id of Object.keys(active)) {
      await ctx.conversation.exit(id);
    }
    return next();
  }

  if (ctx.callbackQuery?.data) {
    const data = ctx.callbackQuery.data;
    // Only the report flow is still a grammY conversation; onboarding's `onb:`
    // taps are ordinary handlers and must force-exit a stale dialog like any
    // other external action.
    const isConversationCallback = data.startsWith("report:");
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
  // Outermost transformer, so the logged duration covers the throttler queue and
  // every auto-retry attempt — i.e. the wait the user actually experienced.
  bot.api.config.use(createApiLogTransformer());

  /**
   * Route registration goes through these helpers rather than `bot.command` /
   * `bot.callbackQuery` / `bot.hears` directly, so every route below is logged
   * — a new command or button becomes observable with no second edit. The
   * handler's own function name is the label in Grafana.
   */
  const onCommand = (command: string, handler: MiddlewareFn<BotContext>): void => {
    bot.command(command, withHandlerLog(handlerName(handler, `command:${command}`), handler));
  };
  const onCallback = (trigger: string | RegExp, handler: MiddlewareFn<BotContext>): void => {
    bot.callbackQuery(trigger, withHandlerLog(handlerName(handler, `callback:${String(trigger)}`), handler));
  };

  // Opens the trace every later record is correlated by — must stay first.
  bot.use(updateTraceMiddleware);

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
    createConversation(handleReportIssue, {
      plugins: [injectServicesPlugin, conversationAuthPlugin()],
      maxMillisecondsToWait: CONVERSATION_WAIT_TIMEOUT_MS,
    }),
  );
  bot.use(exitActiveConversations);

  // Runs before the handlers so a user who never saw the reply keyboard gets it
  // together with the response to the very message they just sent.
  bot.use(mainKeyboardMiddleware);

  onCommand("start", startCommand);
  onCommand("translate", handleTranslateCommand);
  onCommand("mentor", handleMentorCommand);
  onCommand("template", handleTemplateCommand);
  onCommand("dictionary", handleDictionaryCommand);
  onCommand("flashcard", handleFlashcardCommand);
  onCommand("review", handleReviewCommand);
  onCommand("settings", handleSettingsCommand);
  onCommand("changes", changesCommand);
  onCommand("videos", handleVideosCommand);
  onCommand("report", async (ctx) => {
    await ctx.conversation.enter("handleReportIssue");
  });

  // Main-menu reply-keyboard taps arrive as plain text. They must be matched here,
  // ahead of modeRouterMiddleware, or translate mode would try to translate the label.
  bot.hears(
    mainMenuLabels(),
    withHandlerLog("mainMenuTap", async (ctx) => {
      switch (matchMainMenuAction(ctx.msg?.text ?? "")) {
        case "dictionary":
          return handleDictionaryCommand(ctx);
        case "flashcard":
          return handleFlashcardCommand(ctx);
        case "videos":
          return handleVideosCommand(ctx);
        default:
          return;
      }
    }),
  );

  // Inert loading button shown while a long operation runs.
  onCallback(NOOP_CALLBACK, (ctx) => ctx.answerCallbackQuery());

  // "🔄 Try again" on a timeout notice — re-runs the operation that timed out.
  onCallback(RETRY_CALLBACK, handleRetryCallback);

  // Onboarding (Task 72) is a set of plain stateless handlers, not a
  // conversation: every tap re-derives its screen from the database, so a pause
  // of any length cannot leave a button dead and no dialog can swallow the chat.
  onCallback(ONBOARDING_CALLBACK_PATTERN, handleOnboardingCallback);
  // Keyboards from the pre-Task-72 conversation flow are still on screen for
  // anyone mid-onboarding at deploy time; their prefixes now match nothing, so
  // this puts them back on a live screen instead of letting the button spin.
  onCallback(LEGACY_ONBOARDING_CALLBACK_PATTERN, handleLegacyOnboardingCallback);

  // The D+1 activation nudge needs its own prefix: its recipients are all
  // `onboarded = true`, and the `onb:` handlers deliberately ignore those taps.
  onCallback(NUDGE_CALLBACK_PATTERN, handleNudgeCardCallback);

  onCallback("set:native", handleSetNativeCallback);
  onCallback(/^set:native:/, handleSetNativeSelectCallback);
  onCallback("set:learning", handleSetLearningCallback);
  onCallback(/^set:learn:lvl:/, handleSetLearnLevelCallback);
  onCallback(/^set:learn:/, handleSetLearnToggleCallback);
  onCallback("set:interface", handleSetInterfaceCallback);
  onCallback(/^set:iface:/, handleSetIfaceSelectCallback);
  onCallback("set:notif", handleSetNotifCallback);
  onCallback("set:notif:toggle", handleSetNotifToggleCallback);
  onCallback("set:notif:time", handleSetNotifTimeCallback);
  onCallback(/^set:notif:time:/, handleSetNotifTimeSelectCallback);
  onCallback("set:notif:type", handleSetNotifTypeCallback);
  onCallback(/^set:notif:type:/, handleSetNotifTypeSelectCallback);
  onCallback("set:notif:tz", handleSetNotifTzCallback);
  onCallback(/^set:notif:tz:/, handleSetNotifTzSelectCallback);
  onCallback("set:notif:context", handleSetNotifContextCallback);
  onCallback("set:notif:context:cancel", handleSetNotifContextCancelCallback);
  onCallback("set:notif:back", handleSetNotifBackCallback);
  onCallback("set:back", handleSetBackCallback);
  onCallback("set:close", handleSetCloseCallback);

  onCallback(/^notif:reveal:/, handleNotifRevealCallback);
  onCallback(/^notif:learned:/, handleNotifLearnedCallback);

  onCallback(/^tr:save:/, handleSaveCallback);
  onCallback(/^tr:skip:/, handleSkipCallback);
  onCallback(/^tr:regen:/, handleRegenCallback);
  onCallback(/^tr:clarifypost:/, handleClarifyPostCallback);
  onCallback(/^tr:altmeaning:/, handleAltMeaningCallback);
  onCallback(/^tr:gramdetail:/, handleGrammarDetailCallback);
  onCallback(/^tr:gramlang:/, handleGrammarLangSelectCallback);
  onCallback(/^tr:grammar:/, handleGrammarBreakdownCallback);
  onCallback(/^tr:etymology:/, handleEtymologyCallback);
  onCallback("tr:mistype:confirm", handleMistypeConfirmCallback);

  onCallback("plan:upgrade", handleUpgradePromptCallback);
  onCallback(/^plan:buy:/, handleBuyPlanCallback);
  onCallback("tr:mistype:cancel", handleMistypeCancelCallback);
  onCallback(/^tr:langselect:/, handleLangSelectCallback);
  onCallback(/^tr:srclang:/, handleSrcLangOverrideCallback);
  onCallback(/^tr:oos:/, handleOutOfSetCallback);
  onCallback(/^tr:clarify:/, handleTranslationClarificationCallback);

  onCallback("fc:start", handleFcStart);
  onCallback("fc:reveal", handleFcReveal);
  onCallback("fc:next", handleFcNext);
  onCallback("fc:done", handleFcDone);
  onCallback("fc:restart", handleFcRestart);
  onCallback("fc:quit", handleFcQuit);
  onCallback("fc:close", handleFcClose);

  onCallback("srs:reveal", handleSrsReveal);
  onCallback(/^srs:rate:(again|hard|good|easy)$/, handleSrsRate);
  onCallback("srs:restart", handleSrsRestart);
  onCallback("srs:quit", handleSrsQuit);
  onCallback("srs:close", handleSrsClose);

  onCallback(/^dict:page:/, handleDictPage);
  onCallback(/^dict:view:/, handleDictView);
  onCallback(/^dict:delete:/, handleDictDelete);
  onCallback(/^dict:confirm-delete:/, handleDictConfirmDelete);
  onCallback("dict:list", handleDictList);
  onCallback(/^dict:open:/, handleDictOpen);
  onCallback("dict:create", handleDictCreate);
  onCallback(/^dict:rename:/, handleDictRename);
  onCallback(/^dict:delete-dict:/, handleDictDeleteDictionary);
  onCallback(/^dict:confirm-delete-dict:/, handleDictConfirmDeleteDictionary);
  onCallback(/^dict:add-menu:/, handleDictAddMenu);
  onCallback(/^dict:move-menu:/, handleDictMoveMenu);
  onCallback(/^dict:add:/, handleDictAdd);
  onCallback(/^dict:move:/, handleDictMove);
  onCallback(/^dict:translate:/, handleDictTranslate);
  onCallback("dict:close", handleDictClose);
  onCallback("dict:noop", handleDictNoop);

  // Curated starter video from the empty-state screen (Task 72). Must be
  // registered before the generic vid: routes below so its prefix wins.
  onCallback(VIDEO_TRY_PATTERN, handleVideoTryCallback);
  onCallback(/^vid:confirm:/, handleVideoConfirmCallback);
  onCallback(/^vid:cancel:/, handleVideoCancelCallback);
  onCallback(/^vid:browse:/, handleVideoBrowseCallback);
  onCallback(/^vid:save:/, handleVideoSavePhraseCallback);
  onCallback(/^vid:saveall:/, handleVideoSaveAllCallback);
  onCallback(/^vid:list:/, handleVideoListCallback);
  onCallback("vid:close", handleVideoCloseCallback);
  onCallback(/^vid:noop:/, handleVideoNoopCallback);

  onCallback("tpl:customize", handleCustomizeCallback);
  onCallback(/^tpl:toggle:/, handleToggleCallback);
  onCallback("tpl:preview", handlePreviewCallback);
  onCallback("tpl:save", handleSaveTemplateCallback);
  onCallback("tpl:cancel", handleCancelCallback);
  onCallback("tpl:reset", handleResetCallback);
  onCallback("tpl:back", handleBackCallback);

  // Free text from a user who has not finished onboarding: the demo screen runs
  // the real translate path, earlier screens re-render themselves. Anything it
  // does not consume falls through to the mode router untouched.
  bot.use(onboardingTextMiddleware);

  bot.use(modeRouterMiddleware);

  bot.catch(handleBotError);

  return bot;
}

export async function installBotCommands(bot: Bot<BotContext>): Promise<void> {
  await setBotCommands(bot.api);
}
