/**
 * Mentor scene — activates mentor mode.
 *
 * In mentor mode, the user chats with an AI language-learning coach.
 * The coach helps the user translate and learn words through guided
 * conversation — it does NOT translate immediately.
 * Persists mode change to DB so it survives bot restarts.
 */
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../types.js";

/**
 * Handles /mentor command — activates mentor mode.
 * Clears any existing conversation history (fresh start).
 * Persists mode change to DB.
 */
export async function handleMentorCommand(ctx: BotContext): Promise<void> {
  // Set active mode to mentor (session + DB)
  ctx.session.activeMode = "mentor";
  await ctx.services.userRepository.updateActiveMode(ctx.user.id, "mentor");

  // Clear any existing mentor history — each /mentor entry starts fresh
  ctx.session.mentor = undefined;

  // Get user's settings for language display
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Send confirmation message
  await ctx.reply(t("mentorModeOn", lang));
}
