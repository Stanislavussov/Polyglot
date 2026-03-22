/**
 * Translate scene — now mode-based instead of conversation-based.
 * Sets active mode to "translate" and confirms to user.
 * Persists mode to DB so it survives bot restarts.
 */
import { userRepository } from "@polyglot/adapter-db";
import { t, isSupported, type SupportedLang } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { getLangDisplay } from "@polyglot/adapter-db";

/**
 * Handles /translate command — activates translate mode.
 * In translate mode, every plain text message is translated automatically.
 * Persists mode change to DB.
 */
export async function handleTranslateCommand(ctx: BotContext): Promise<void> {
  // Set active mode to translate (session + DB)
  ctx.session.activeMode = "translate";
  await userRepository.updateActiveMode(ctx.user.id, "translate");

  // Get user's settings
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  // Build language display strings
  const fromLang = getLangDisplay(nativeLang);
  const toLangs = learningLangs.map(getLangDisplay).join(", ") || "—";

  // Send confirmation message with language direction
  await ctx.reply(t("translateModeOn", lang, { fromLang, toLangs }));
}
