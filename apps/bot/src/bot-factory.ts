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

  if (ctx.message?.text?.startsWith("/")) {
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

  // "🔄 Try again" on a timeout notice — re-runs the operation that timed out.
  bot.callbackQuery(RETRY_CALLBACK, handleRetryCallback);

  // Onboarding (Task 72) is a set of plain stateless handlers, not a
  // conversation: every tap re-derives its screen from the database, so a pause
  // of any length cannot leave a button dead and no dialog can swallow the chat.
  bot.callbackQuery(ONBOARDING_CALLBACK_PATTERN, handleOnboardingCallback);
  // Keyboards from the pre-Task-72 conversation flow are still on screen for
  // anyone mid-onboarding at deploy time; their prefixes now match nothing, so
  // this puts them back on a live screen instead of letting the button spin.
  bot.callbackQuery(LEGACY_ONBOARDING_CALLBACK_PATTERN, handleLegacyOnboardingCallback);

  // The D+1 activation nudge needs its own prefix: its recipients are all
  // `onboarded = true`, and the `onb:` handlers deliberately ignore those taps.
  bot.callbackQuery(NUDGE_CALLBACK_PATTERN, handleNudgeCardCallback);

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
  bot.callbackQuery(/^tr:srclang:/, handleSrcLangOverrideCallback);
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

  // Curated starter video from the empty-state screen (Task 72). Must be
  // registered before the generic vid: routes below so its prefix wins.
  bot.callbackQuery(VIDEO_TRY_PATTERN, handleVideoTryCallback);
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
