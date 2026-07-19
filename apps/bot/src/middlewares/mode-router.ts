/**
 * Mode router middleware — routes plain text messages based on active mode.
 * This is the core of the persistent mode system.
 *
 * Translation is always-on for onboarded users: even if mode is somehow "idle",
 * the router falls back to translation rather than silently dropping messages.
 */

import { isVideoUrl, isYouTubeUrl } from "@polyglot/adapter-youtube";
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import type { NextFunction } from "grammy";
import { handleTranslationClarificationContextText } from "../scenes/helpers/clarification.js";
import { handleDictionaryNameInput } from "../scenes/helpers/dictionary.helper.js";
import { handleMentorText } from "../scenes/helpers/mentor-mode.helper.js";
import { handleNotifContextTextInput } from "../scenes/helpers/settings.helper.js";
import { handleTranslateText } from "../scenes/helpers/translate-flow.js";
import { handleVideoVocabularyUrl } from "../scenes/helpers/video-vocabulary.helper.js";
import type { BotContext } from "../types.js";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";
import { detectNonTextContent, isEmojiOnly } from "../utils/validate-text-input.js";
import { getRequestSettings } from "./request-settings.js";

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
      const nonTextType = detectNonTextContent(ctx.message as unknown as Record<string, unknown>);
      logger.debug({ nonTextType, userId: ctx.from?.id }, "Non-text message received from onboarded user");
      const lang = await resolveInterfaceLang(ctx);
      const msg = await ctx.reply(t("textOnly", lang));
      trackTechnicalMessage(ctx, msg.message_id);
      return;
    }
    return next();
  }

  // Emoji-only messages — cannot be translated
  if (isEmojiOnly(text)) {
    if (ctx.user?.onboarded) {
      logger.debug({ textPreview: text, userId: ctx.from?.id }, "Emoji-only message received");
      const lang = await resolveInterfaceLang(ctx);
      const msg = await ctx.reply(t("emojiNotSupported", lang));
      trackTechnicalMessage(ctx, msg.message_id);
      return;
    }
    return next();
  }

  // Capture notification context text input
  if (ctx.session.awaitingNotifContext) {
    await handleNotifContextTextInput(ctx);
    return;
  }

  if (ctx.session.dictionaryWizard) {
    await handleDictionaryNameInput(ctx);
    return;
  }

  if (ctx.session.awaitingTranslationClarificationContext) {
    await handleTranslationClarificationContextText(ctx, text);
    return;
  }

  // YouTube URL → video vocabulary flow
  if (ctx.user?.onboarded && isYouTubeUrl(text)) {
    await handleVideoVocabularyUrl(ctx, text);
    return;
  }
  // Non-YouTube video URL → "only YouTube supported"
  if (ctx.user?.onboarded && isVideoUrl(text)) {
    const lang = await resolveInterfaceLang(ctx);
    const msg = await ctx.reply(t("videoOnlyYouTube", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  // Route based on active mode
  const mode = ctx.session.activeMode;
  const userId = ctx.from?.id;

  logger.debug({ mode, textPreview: text.slice(0, 30), userId }, "Mode router: routing message");

  switch (mode) {
    case "translate":
      await handleTranslateText(ctx, text);
      return; // Don't call next() — we handled it
    case "mentor":
      await handleMentorText(ctx, text);
      return;
    default: {
      // Safety net: idle mode should not silently drop messages.
      // For onboarded users → fall back to translation and persist to DB.
      // For non-onboarded users → hint to run /start.
      const user = ctx.user;

      if (user?.onboarded) {
        logger.warn({ mode, userId }, "Onboarded user hit idle mode — falling back to translate");
        ctx.session.activeMode = "translate";
        await ctx.services.userRepository.updateActiveMode(user.id, "translate");
        await handleTranslateText(ctx, text);
        return;
      }

      // Non-onboarded user — show hint to start onboarding
      const settings = user ? await getRequestSettings(ctx, user.id) : null;
      const rawLang = settings?.interfaceLang ?? "en";
      const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";
      const msg = await ctx.reply(t("welcome", lang));
      trackTechnicalMessage(ctx, msg.message_id);
      return;
    }
  }
}
