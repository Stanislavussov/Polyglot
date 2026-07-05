import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";
import { setUserCommands } from "./commands.js";

/**
 * /start command handler.
 *
 * - If user is not onboarded → enter the onboarding conversation
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
    const msg = await ctx.reply(t("welcomeBack", lang));
    trackTechnicalMessage(ctx, msg.message_id);
  } else {
    // Start onboarding conversation
    await ctx.conversation.enter("onboarding");
  }
}
