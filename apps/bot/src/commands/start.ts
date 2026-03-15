import type { BotContext } from "../types.js";
import { t } from "../constants.js";
import { userRepository } from "@polyglot/adapter-db";
import { logger } from "@polyglot/infra";

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
    // User already onboarded — show main menu
    const settings = await userRepository.getSettings(user.id);
    const lang = settings?.interfaceLang ?? "en";
    await ctx.reply(t("welcomeBack", lang));
  } else {
    // Start onboarding conversation
    await ctx.conversation.enter("onboarding");
  }
}
