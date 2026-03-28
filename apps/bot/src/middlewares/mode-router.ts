/**
 * Mode router middleware — routes plain text messages based on active mode.
 * This is the core of the persistent mode system.
 *
 * Translation is always-on for onboarded users: even if mode is somehow "idle",
 * the router falls back to translation rather than silently dropping messages.
 */

import { userRepository } from "@polyglot/adapter-db";
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import { logger } from "@polyglot/infra";
import type { NextFunction } from "grammy";
import { handleTranslateText } from "../scenes/helpers/translate-mode.helper.js";
import type { BotContext } from "../types.js";

/**
 * Routes plain text messages to the appropriate mode handler.
 * Commands (starting with /) are NOT processed here — they go through normal handlers.
 */
export async function modeRouterMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  // Only handle plain text messages (not commands)
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
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
