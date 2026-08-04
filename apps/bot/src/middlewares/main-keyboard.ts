/**
 * Delivers the persistent main-menu keyboard once per user.
 *
 * A reply keyboard only reaches Telegram attached to an outgoing message, so users
 * who onboarded before the menu existed would never see it — and the entry points it
 * replaced are no longer in the command list. This sends it with a one-time hint on
 * the user's next message, then never again (the version flag lives in the
 * Postgres-backed session, so it survives restarts).
 */

import { isSupported, type SupportedLang, t } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { buildMainKeyboard } from "../utils/main-menu.js";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";
import { getRequestSettings } from "./request-settings.js";

/** Bump when the keyboard layout changes so every user is re-sent the new one once. */
export const MAIN_KEYBOARD_VERSION = 1;

export async function mainKeyboardMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const user = ctx.user;

  // Message updates only: a callback-query answer cannot carry a reply keyboard.
  // Non-onboarded users get the keyboard from the onboarding flow instead.
  if (!ctx.message || !user?.onboarded || ctx.session.mainKeyboardVersion === MAIN_KEYBOARD_VERSION) {
    return next();
  }

  ctx.session.mainKeyboardVersion = MAIN_KEYBOARD_VERSION;

  const settings = await getRequestSettings(ctx, user.id);
  const rawLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";

  const msg = await ctx.reply(t("mainMenuHint", lang), { reply_markup: buildMainKeyboard(lang) });
  trackTechnicalMessage(ctx, msg.message_id);

  return next();
}
