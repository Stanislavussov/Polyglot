/**
 * Mode router middleware — routes plain text messages based on active mode.
 * This is the core of the persistent mode system.
 *
 * Translation is always-on for onboarded users: even if mode is somehow "idle",
 * the router falls back to translation rather than silently dropping messages.
 */

import { userRepository } from "@polyglot/adapter-db";
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import { logger } from "@polyglot/core";
import type { NextFunction } from "grammy";
import { handleTranslateText } from "../scenes/helpers/translate-mode.helper.js";
import type { BotContext } from "../types.js";
import { detectNonTextContent, isEmojiOnly } from "../utils/validate-text-input.js";

/**
 * Resolve the user's interface language from DB settings.
 * Falls back to "en" if unavailable.
 */
async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const user = ctx.user;
  if (!user) return "en";
  const settings = await userRepository.getSettings(user.id);
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
      await ctx.reply(t("textOnly", lang));
      return;
    }
    return next();
  }

  // Emoji-only messages — cannot be translated
  if (isEmojiOnly(text)) {
    if (ctx.user?.onboarded) {
      logger.debug({ text, userId: ctx.from?.id }, "Emoji-only message received");
      const lang = await resolveInterfaceLang(ctx);
      await ctx.reply(t("emojiNotSupported", lang));
      return;
    }
    return next();
  }

  // Route based on active mode
  const mode = ctx.session.activeMode;
  const userId = ctx.from?.id;

  logger.debug({ mode, text: text.slice(0, 30), userId }, "Mode router: routing message");

  switch (mode) {
    case "translate":
      await handleTranslateText(ctx, text);
      return; // Don't call next() — we handled it
    default: {
      // Safety net: idle mode should not silently drop messages.
      // For onboarded users → fall back to translation and persist to DB.
      // For non-onboarded users → hint to run /start.
      const user = ctx.user;

      if (user?.onboarded) {
        logger.warn({ mode, userId }, "Onboarded user hit idle mode — falling back to translate");
        ctx.session.activeMode = "translate";
        await userRepository.updateActiveMode(user.id, "translate");
        await handleTranslateText(ctx, text);
        return;
      }

      // Non-onboarded user — show hint to start onboarding
      const settings = user ? await userRepository.getSettings(user.id) : null;
      const rawLang = settings?.interfaceLang ?? "en";
      const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";
      await ctx.reply(t("welcome", lang));
      return;
    }
  }
}
