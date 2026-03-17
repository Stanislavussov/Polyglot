/**
 * Translate scene — now mode-based instead of conversation-based.
 * Sets active mode to "translate" and confirms to user.
 */
import { userRepository } from "@polyglot/adapter-db";
import { t, isSupported, type SupportedLang } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { langDisplay } from "../constants.js";

/**
 * Handles /translate command — activates translate mode.
 * In translate mode, every plain text message is translated automatically.
 */
export async function handleTranslateCommand(ctx: BotContext): Promise<void> {
  // Set active mode to translate
  ctx.session.activeMode = "translate";

  // Get user's settings
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  // Build language display strings
  const fromLang = langDisplay(nativeLang);
  const toLangs = learningLangs.map(langDisplay).join(", ") || "—";

  // Send confirmation message with language direction
  await ctx.reply(t("translateModeOn", lang, { fromLang, toLangs }));
}
