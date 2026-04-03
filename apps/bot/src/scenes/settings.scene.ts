/**
 * Settings scene — /settings command handler.
 * Shows current language configuration with inline buttons to change each setting.
 * Callback handlers are in helpers/settings.helper.ts.
 */
import { getLangDisplay, userRepository } from "@polyglot/adapter-db";
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";

/**
 * Build the settings main menu text showing current configuration.
 */
export function buildSettingsText(
  nativeLang: string,
  learningLangs: string[],
  interfaceLang: string,
  lang: SupportedLang,
): string {
  const lines: string[] = [
    t("settingsTitle", lang),
    "",
    t("settingsNativeLang", lang, { lang: getLangDisplay(nativeLang) }),
    t("settingsLearningLangs", lang, {
      langs: learningLangs.map(getLangDisplay).join(", ") || "—",
    }),
    t("settingsInterfaceLang", lang, { lang: getLangDisplay(interfaceLang) }),
  ];
  return lines.join("\n");
}

/**
 * Build the settings main menu keyboard with Change buttons.
 */
export function buildSettingsKeyboard(lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t("settingsChangeNative", lang), "set:native").row();
  kb.text(t("settingsChangeLearning", lang), "set:learning").row();
  kb.text(t("settingsChangeInterface", lang), "set:interface").row();
  kb.text(t("settingsClose", lang), "set:close").row();
  return kb;
}

/** /settings command handler */
export async function handleSettingsCommand(ctx: BotContext): Promise<void> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];
  const interfaceLang = settings?.interfaceLang ?? "en";

  const text = buildSettingsText(nativeLang, learningLangs, interfaceLang, lang);
  const kb = buildSettingsKeyboard(lang);

  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
}
