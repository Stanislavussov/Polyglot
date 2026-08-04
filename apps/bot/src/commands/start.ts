import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { MAIN_KEYBOARD_VERSION } from "../middlewares/main-keyboard.js";
import { startOnboarding } from "../onboarding/onboarding-handlers.js";
import type { BotContext } from "../types.js";
import { buildMainKeyboard } from "../utils/main-menu.js";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";
import { setUserCommands } from "./commands.js";

/**
 * /start command handler.
 *
 * - If user is not onboarded → render the onboarding screen they are up to
 * - If user is already onboarded → show the main menu
 */
export async function startCommand(ctx: BotContext): Promise<void> {
  const user = ctx.user;

  if (!user) {
    logger.error("startCommand called without user in context");
    return;
  }

  if (user.onboarded) {
    // User already onboarded — restore translate mode and persist to DB
    ctx.session.activeMode = "translate";
    ctx.session.needsTranslateReminder = true;
    await ctx.services.userRepository.updateActiveMode(user.id, "translate");
    const settings = await ctx.services.userRepository.getSettings(user.id);
    const rawLang = settings?.interfaceLang ?? "en";
    const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";
    const chatId = ctx.from?.id;
    if (chatId) {
      await setUserCommands(ctx.api, chatId, lang, user.audienceGroup);
    }
    // /start re-installs the main-menu keyboard, so the one-time hint from
    // mainKeyboardMiddleware would be redundant for this chat.
    ctx.session.mainKeyboardVersion = MAIN_KEYBOARD_VERSION;
    const msg = await ctx.reply(t("welcomeBack", lang), { reply_markup: buildMainKeyboard(lang) });
    trackTechnicalMessage(ctx, msg.message_id);
  } else {
    // Onboarding is stateless (Task 72): resume on the furthest screen reached,
    // never restart from screen 0.
    await startOnboarding(ctx);
  }
}
