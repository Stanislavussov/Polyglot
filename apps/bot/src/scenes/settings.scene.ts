/**
 * Settings scene — /settings command handler.
 * Shows current language configuration + notification preferences
 * with inline buttons to change each setting.
 * Callback handlers are in helpers/settings.helper.ts.
 */
import { formatNotificationHour, getLangDisplay, parseNotificationHour, userRepository } from "@polyglot/adapter-db";
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
  notifEnabled?: boolean,
  notifTime?: string,
  notifType?: string,
  timezone?: string,
): string {
  const lines: string[] = [
    t("settingsTitle", lang),
    "",
    t("settingsNativeLang", lang, { lang: getLangDisplay(nativeLang) }),
    t("settingsLearningLangs", lang, {
      langs: learningLangs.map(getLangDisplay).join(", ") || "—",
    }),
    t("settingsInterfaceLang", lang, { lang: getLangDisplay(interfaceLang) }),
    "",
    t("settingsNotifSection", lang),
    notifEnabled ? t("settingsNotifEnabled", lang) : t("settingsNotifDisabled", lang),
  ];
  if (notifEnabled) {
    const displayTime = formatNotificationHour(parseNotificationHour(notifTime));
    lines.push(t("settingsNotifTime", lang, { time: displayTime }));
    lines.push(t("settingsNotifType", lang, { type: notifType ?? "both" }));
    lines.push(t("settingsNotifTimezone", lang, { timezone: timezone ?? "UTC" }));
  }
  return lines.join("\n");
}

/**
 * Build the settings main menu keyboard with Change buttons.
 */
export function buildSettingsKeyboard(lang: SupportedLang, notifEnabled?: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t("settingsChangeNative", lang), "set:native").row();
  kb.text(t("settingsChangeLearning", lang), "set:learning").row();
  kb.text(t("settingsChangeInterface", lang), "set:interface").row();
  kb.text(t("settingsNotifToggle", lang), "set:notif:toggle").row();
  if (notifEnabled) {
    kb.text(t("settingsNotifChooseTime", lang), "set:notif:time").row();
    kb.text(t("settingsNotifChooseType", lang), "set:notif:type").row();
    kb.text(t("settingsNotifChooseTimezone", lang), "set:notif:tz").row();
  }
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
  const notifEnabled = (settings as any)?.notificationEnabled ?? false;
  const notifTime = (settings as any)?.notificationTime ?? "8";
  const notifType = (settings as any)?.notificationType ?? "both";
  const timezone = settings?.timezone ?? "UTC";

  const text = buildSettingsText(
    nativeLang, learningLangs, interfaceLang, lang,
    notifEnabled, notifTime, notifType, timezone,
  );
  const kb = buildSettingsKeyboard(lang, notifEnabled);

  await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
}
