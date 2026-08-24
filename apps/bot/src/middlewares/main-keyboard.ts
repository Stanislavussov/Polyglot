/**
 * Delivers the main-menu keyboard once per user.
 *
 * A reply keyboard only reaches Telegram attached to an outgoing message, and the
 * menu is not pinned to the screen — so the one delivery is also the one moment the
 * user is told where it lives. New users get it from the onboarding hand-off; this
 * middleware is the path for everyone who onboarded before the menu existed (or
 * before its current layout), sending it with the same hint on their next message
 * and then never again. The version flag lives in the Postgres-backed session, so
 * it survives restarts.
 */

import { isSupported, type SupportedLang, t } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";
import { buildMainKeyboard } from "../utils/main-menu.js";
import { getRequestSettings } from "./request-settings.js";

/** Bump when the keyboard layout changes so every user is re-sent the new one once. */
export const MAIN_KEYBOARD_VERSION = 4;

/**
 * Sends `text` with the main-menu keyboard attached.
 *
 * Telegram binds a reply keyboard to the message that delivered it: delete that
 * message and the keyboard disappears from the user's screen. Nothing in the bot
 * deletes it, so the keyboard is sent once per layout version.
 *
 * The version flag is set only after Telegram accepted the message, so a failed
 * send is retried on the next update instead of marking the chat as done.
 */
export async function installMainKeyboard(ctx: BotContext, text: string, lang: SupportedLang): Promise<void> {
  await ctx.reply(text, { reply_markup: buildMainKeyboard(lang) });
  // Guarded: the onboarding hand-off can run on a context rebuilt outside the
  // session middleware. Without a session the delivery still happened — the
  // middleware simply re-sends the hint on the user's next message.
  if (!ctx.session) return;
  ctx.session.mainKeyboardVersion = MAIN_KEYBOARD_VERSION;
}

export async function mainKeyboardMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const user = ctx.user;

  // Message updates only: a callback-query answer cannot carry a reply keyboard.
  // A user still mid-onboarding gets it from the final onboarding screen.
  if (!ctx.message || !user?.onboarded || ctx.session.mainKeyboardVersion === MAIN_KEYBOARD_VERSION) {
    return next();
  }

  const settings = await getRequestSettings(ctx, user.id);
  const rawLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";

  await installMainKeyboard(ctx, t("mainMenuHint", lang), lang);

  return next();
}
