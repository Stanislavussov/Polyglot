/**
 * Delivers the persistent main-menu keyboard once per user.
 *
 * A reply keyboard only reaches Telegram attached to an outgoing message, so users
 * who onboarded before the menu existed would never see it. This sends it with a
 * one-time hint on the user's next message, then never again (the version flag
 * lives in the Postgres-backed session, so it survives restarts).
 */

import { isSupported, type SupportedLang, t } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { buildMainKeyboard } from "../utils/main-menu.js";
import { getRequestSettings } from "./request-settings.js";

/** Bump when the keyboard layout changes so every user is re-sent the new one once. */
export const MAIN_KEYBOARD_VERSION = 2;

/**
 * Sends `text` with the main-menu keyboard attached and records the carrier message.
 *
 * Telegram binds a reply keyboard to the message that delivered it: delete that
 * message and the keyboard disappears from the user's screen. The carrier is
 * therefore deliberately **not** passed to `trackTechnicalMessage` — technical
 * messages are wiped before every translation, which is exactly how the keyboard
 * used to vanish after a single use. Its id is remembered so
 * `cleanupTechnicalMessages` can re-arm delivery should anything delete it anyway.
 *
 * The version flag is set only after Telegram accepted the message, so a failed
 * send is retried on the next update instead of marking the chat as done.
 */
export async function installMainKeyboard(ctx: BotContext, text: string, lang: SupportedLang): Promise<void> {
  const msg = await ctx.reply(text, { reply_markup: buildMainKeyboard(lang) });
  ctx.session.mainKeyboardVersion = MAIN_KEYBOARD_VERSION;
  ctx.session.mainKeyboardMessageId = msg.message_id;
}

export async function mainKeyboardMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const user = ctx.user;

  // Message updates only: a callback-query answer cannot carry a reply keyboard.
  // A user still mid-onboarding gets it on their first message after finishing.
  if (!ctx.message || !user?.onboarded || ctx.session.mainKeyboardVersion === MAIN_KEYBOARD_VERSION) {
    return next();
  }

  const settings = await getRequestSettings(ctx, user.id);
  const rawLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";

  await installMainKeyboard(ctx, t("mainMenuHint", lang), lang);

  return next();
}
