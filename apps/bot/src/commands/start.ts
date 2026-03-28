import { userRepository } from "@polyglot/adapter-db";
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import { logger } from "@polyglot/infra";
import type { BotContext } from "../types.js";

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
    await userRepository.updateActiveMode(user.id, "translate");
    const settings = await userRepository.getSettings(user.id);
    const rawLang = settings?.interfaceLang ?? "en";
    const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";
    await ctx.reply(t("welcomeBack", lang));
  } else {
    // Start onboarding conversation
    await ctx.conversation.enter("onboarding");
  }
}
