/**
 * Translate scene — now mode-based instead of conversation-based.
 * Sets active mode to "translate" and confirms to user.
 * Persists mode to DB so it survives bot restarts.
 */
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../types.js";
import { replyTechnical } from "../utils/message-cleanup.js";

/**
 * Switches the chat into translate mode (session + DB) and resolves the
 * language direction for the confirmation copy. Shared by /translate and the
 * mentor-exit button, so the mode switch itself can never drift between them —
 * only the confirmation wording differs per entry point.
 */
export async function activateTranslateMode(
  ctx: BotContext,
): Promise<{ lang: SupportedLang; fromLang: string; toLangs: string }> {
  ctx.session.activeMode = "translate";
  await ctx.services.userRepository.updateActiveMode(ctx.user.id, "translate");

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  const fromLang = ctx.services.languageCache.getLangDisplay(nativeLang);
  const toLangs = learningLangs.map((code) => ctx.services.languageCache.getLangDisplay(code)).join(", ") || "—";

  // No source lang menu on mode entry (Task 58 — detection happens on first text message)
  ctx.session.needsTranslateReminder = false;

  return { lang, fromLang, toLangs };
}

/**
 * Handles /translate command — activates translate mode.
 * In translate mode, every plain text message is translated automatically.
 */
export async function handleTranslateCommand(ctx: BotContext): Promise<void> {
  const { lang, fromLang, toLangs } = await activateTranslateMode(ctx);
  await replyTechnical(ctx, t("translateModeOn", lang, { fromLang, toLangs }));
}
