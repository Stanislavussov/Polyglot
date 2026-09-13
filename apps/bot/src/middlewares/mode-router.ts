/**
 * Mode router middleware — routes plain text messages based on active mode.
 * This is the core of the persistent mode system.
 *
 * Translation is always-on for onboarded users: even if mode is somehow "idle",
 * the router falls back to translation rather than silently dropping messages.
 */

import { isVideoUrl, isYouTubeUrl } from "@polyglot/adapter-youtube";
import { isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import type { NextFunction } from "grammy";
import { markHandled } from "../observability/handler-log.js";
import { dispatchByActiveMode } from "../scenes/helpers/active-mode-dispatch.js";
import { tryHandleCardMentorQuestion } from "../scenes/helpers/card-mentor.js";
import { handleTranslationClarificationContextText } from "../scenes/helpers/clarification.js";
import { handleDictionaryNameInput } from "../scenes/helpers/dictionary.helper.js";
import { tryHandleMentorReply } from "../scenes/helpers/mentor-thread.helper.js";
import { handleNotifContextTextInput } from "../scenes/helpers/settings.helper.js";
import { handleVideoVocabularyUrl } from "../scenes/helpers/video-vocabulary.helper.js";
import { handleVoiceMessage } from "../scenes/helpers/voice-input.js";
import type { BotContext } from "../types.js";
import { detectNonTextContent, isEmojiOnly, type NonTextType } from "../utils/validate-text-input.js";
import { getRequestSettings } from "./request-settings.js";

/**
 * Clips get their own refusal: a "text only" answer reads as a bug to someone
 * who just filmed something, and the bot has no video pipeline behind a chat
 * upload (the YouTube flow takes links, not files).
 */
const VIDEO_TYPES = new Set<NonTextType>(["video", "video_note", "animation"]);

/**
 * Resolve the user's interface language from DB settings.
 * Falls back to "en" if unavailable.
 */
async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const user = ctx.user;
  if (!user) return "en";
  const settings = await getRequestSettings(ctx, user.id);
  const rawLang = settings?.interfaceLang ?? "en";
  return isSupported(rawLang) ? rawLang : "en";
}

/**
 * Routes plain text messages to the appropriate mode handler.
 * Commands (starting with /) are NOT processed here — they go through normal handlers.
 */
export async function modeRouterMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  // Only handle message updates (not callback queries, edits, etc.)
  if (!ctx.message) {
    return next();
  }

  const text = ctx.message.text;

  // Commands go through normal handlers
  if (text?.startsWith("/")) {
    return next();
  }

  // Non-text messages (stickers, GIFs, photos, voice, etc.)
  if (!text) {
    if (ctx.user?.onboarded) {
      // A voice message is translatable input when speech-to-text is on; the
      // handler returns false when it is off, so the rejection below stays the
      // unchanged fallback.
      if (ctx.message.voice && (await handleVoiceMessage(ctx))) {
        markHandled(ctx, "modeRouter:voice");
        return;
      }
      const nonTextType = detectNonTextContent(ctx.message as unknown as Record<string, unknown>);
      const isVideo = nonTextType !== null && VIDEO_TYPES.has(nonTextType);
      markHandled(ctx, isVideo ? "modeRouter:video" : "modeRouter:nonText");
      logEvent("mode_router.rejected", {
        reason: isVideo ? "video" : "non_text",
        contentType: nonTextType,
      });
      const lang = await resolveInterfaceLang(ctx);
      await ctx.reply(t(isVideo ? "videoNotSupported" : "textOnly", lang));
      return;
    }
    return next();
  }

  // Emoji-only messages — cannot be translated
  if (isEmojiOnly(text)) {
    if (ctx.user?.onboarded) {
      markHandled(ctx, "modeRouter:emojiOnly");
      logEvent("mode_router.rejected", { reason: "emoji_only" });
      const lang = await resolveInterfaceLang(ctx);
      await ctx.reply(t("emojiNotSupported", lang));
      return;
    }
    return next();
  }

  // Capture notification context text input
  if (ctx.session.awaitingNotifContext) {
    markHandled(ctx, "modeRouter:notifContext");
    await handleNotifContextTextInput(ctx);
    return;
  }

  if (ctx.session.dictionaryWizard) {
    markHandled(ctx, "modeRouter:dictionaryName");
    await handleDictionaryNameInput(ctx);
    return;
  }

  if (ctx.session.awaitingTranslationClarificationContext) {
    markHandled(ctx, "modeRouter:clarificationContext");
    await handleTranslationClarificationContextText(ctx, text);
    return;
  }

  // The card's "what would you like to clarify?" prompt claims the next message
  // as its question, and answering it is what moves the user into mentor mode.
  if (await tryHandleCardMentorQuestion(ctx, text)) {
    markHandled(ctx, "modeRouter:cardMentorQuestion");
    return;
  }

  // Reply to a mentor answer → continue that thread, regardless of active mode.
  // After the wizard interceptors (one-shot prompts sent moments earlier win),
  // before URL detection (an explicit reply names its target).
  if (ctx.user?.onboarded && ctx.message.reply_to_message) {
    if (await tryHandleMentorReply(ctx, text)) {
      markHandled(ctx, "modeRouter:mentorReply");
      return;
    }
  }

  // YouTube URL → video vocabulary flow
  if (ctx.user?.onboarded && isYouTubeUrl(text)) {
    markHandled(ctx, "modeRouter:youtubeUrl");
    await handleVideoVocabularyUrl(ctx, text);
    return;
  }
  // Non-YouTube video URL → "only YouTube supported"
  if (ctx.user?.onboarded && isVideoUrl(text)) {
    markHandled(ctx, "modeRouter:unsupportedVideoUrl");
    logEvent("mode_router.rejected", { reason: "non_youtube_video_url" });
    const lang = await resolveInterfaceLang(ctx);
    await ctx.reply(t("videoOnlyYouTube", lang));
    return;
  }

  // Route based on active mode
  const mode = ctx.session.activeMode;

  logEvent("mode_router.routed", { mode, textLength: text.length });

  const isKnownMode = mode === "translate" || mode === "mentor";
  if (!isKnownMode && !ctx.user?.onboarded) {
    // Non-onboarded user with no mode — hint to start onboarding.
    markHandled(ctx, "modeRouter:welcomeHint");
    logEvent("mode_router.welcome_hint", {});
    const settings = ctx.user ? await getRequestSettings(ctx, ctx.user.id) : null;
    const rawLang = settings?.interfaceLang ?? "en";
    const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";
    await ctx.reply(t("welcome", lang));
    return;
  }

  await dispatchByActiveMode(ctx, text);
}
