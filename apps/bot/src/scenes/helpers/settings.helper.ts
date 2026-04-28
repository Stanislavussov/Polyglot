/**
 * Settings callback handlers — set:* callbacks.
 * Manages native/learning/interface language pickers, notification prefs, and close.
 */
import {
  formatNotificationHour,
  MAX_NOTIFICATION_HOUR,
  MIN_NOTIFICATION_HOUR,
  NOTIFICATION_TYPES,
} from "@polyglot/adapter-db";
import { isSupported, type NotificationType, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { setUserCommands } from "../../commands/commands.js";
import { MAX_LEARNING_LANGS } from "../../constants.js";
import type { BotContext } from "../../types.js";
import { buildSettingsKeyboard, buildSettingsText } from "../settings.scene.js";

/** Resolve interface language from user settings */
async function getLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return (isSupported(iLang) ? iLang : "en") as SupportedLang;
}

/** Re-render the settings main menu (after a change or back navigation) */
async function showSettingsMenu(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const notifEnabled = (settings as any)?.notificationEnabled ?? false;
  const notifTime = (settings as any)?.notificationTime ?? "8";
  const notifType = (settings as any)?.notificationType ?? "both";
  const timezone = settings?.timezone ?? "UTC";

  const text = buildSettingsText(
    settings?.nativeLang ?? "en",
    settings?.learningLangs ?? [],
    settings?.interfaceLang ?? "en",
    lang,
    notifEnabled,
    notifTime,
    notifType,
    timezone,
  );
  const kb = buildSettingsKeyboard(lang, notifEnabled);
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
}

/** set:native — show native language picker */
export async function handleSetNativeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  for (const l of ctx.services.languageCache.getSupportedLangs()) {
    kb.text(ctx.services.languageCache.getLangDisplay(l.code), `set:native:${l.code}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsChooseNative", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:native:{code} — select a native language */
export async function handleSetNativeSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:native:", "");
  const lang = await getLang(ctx);

  await ctx.services.userRepository.updateNativeLang(ctx.user.id, code);
  await ctx.answerCallbackQuery({
    text: t("settingsNativeUpdated", lang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
  });
  await showSettingsMenu(ctx);
}

/** set:learning — show learning language multi-select */
export async function handleSetLearningCallback(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = settings?.learningLangs ?? [];

  const kb = buildLearningKeyboard(ctx, selected, nativeLang, lang);
  await ctx.editMessageText(t("settingsChooseLearning", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** Build multi-select keyboard for learning languages */
function buildLearningKeyboard(
  ctx: BotContext,
  selected: string[],
  nativeLang: string,
  lang: SupportedLang,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const l of ctx.services.languageCache.getSupportedLangs()) {
    if (l.code === nativeLang) continue;
    const isSelected = selected.includes(l.code);
    const prefix = isSelected ? "✅ " : "";
    kb.text(`${prefix}${ctx.services.languageCache.getLangDisplay(l.code)}`, `set:learn:${l.code}`).row();
  }
  if (selected.length > 0) {
    kb.text(t("done", lang), "set:learn:done").row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();
  return kb;
}

/** set:learn:{code} — toggle a learning language */
export async function handleSetLearnToggleCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:learn:", "");

  if (code === "done") {
    return handleSetLearnDoneCallback(ctx);
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = [...(settings?.learningLangs ?? [])];

  const idx = selected.indexOf(code);
  if (idx >= 0) {
    selected.splice(idx, 1);
    await ctx.answerCallbackQuery({
      text: t("langRemoved", lang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
    });
  } else if (selected.length >= MAX_LEARNING_LANGS) {
    await ctx.answerCallbackQuery({
      text: t("maxLangsReached", lang, { max: MAX_LEARNING_LANGS }),
      show_alert: true,
    });
    return;
  } else {
    selected.push(code);
    await ctx.answerCallbackQuery({
      text: t("langAdded", lang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
    });
  }

  // Persist intermediate state so it's kept across callbacks
  await ctx.services.userRepository.updateLearningLangs(ctx.user.id, selected);

  const kb = buildLearningKeyboard(ctx, selected, nativeLang, lang);
  await ctx.editMessageReplyMarkup({ reply_markup: kb });
}

/** set:learn:done — confirm learning language selection */
async function handleSetLearnDoneCallback(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const selected = settings?.learningLangs ?? [];

  if (selected.length === 0) {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: t("selectAtLeastOne", lang),
      show_alert: true,
    });
    return;
  }

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({ text: t("settingsLearningUpdated", lang) });
  await showSettingsMenu(ctx);
}

/** set:interface — show interface language picker */
export async function handleSetInterfaceCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  for (const l of ctx.services.languageCache.getSupportedLangs()) {
    kb.text(ctx.services.languageCache.getLangDisplay(l.code), `set:iface:${l.code}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsChooseInterface", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:iface:{code} — select an interface language */
export async function handleSetIfaceSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:iface:", "");

  await ctx.services.userRepository.updateInterfaceLang(ctx.user.id, code);

  // Use the NEW interface language for the confirmation
  const newLang = (isSupported(code) ? code : "en") as SupportedLang;
  await ctx.answerCallbackQuery({
    text: t("settingsInterfaceUpdated", newLang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
  });

  // Update bot commands for the user's new language
  const chatId = ctx.from?.id;
  if (chatId) {
    await setUserCommands(ctx.api, chatId, newLang);
  }

  await showSettingsMenu(ctx);
}

/** set:notif:toggle — enable/disable notifications */
export async function handleSetNotifToggleCallback(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const currentEnabled = (settings as any)?.notificationEnabled ?? false;
  const newEnabled = !currentEnabled;

  await ctx.services.notificationRepository.updatePrefs(ctx.user.id, {
    notificationEnabled: newEnabled,
  });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: newEnabled ? t("settingsNotifEnabled", lang) : t("settingsNotifDisabled", lang),
  });
  await showSettingsMenu(ctx);
}

/** Build emoji icon for a given hour */
function hourIcon(hour: number): string {
  if (hour >= 6 && hour < 12) return "🌅";
  if (hour >= 12 && hour < 18) return "☀️";
  if (hour >= 18 && hour < 22) return "🌙";
  return "🌑";
}

/** set:notif:time — show notification time picker with hourly grid */
export async function handleSetNotifTimeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();

  // Show hours in rows of 4 buttons for a compact grid
  for (let h = MIN_NOTIFICATION_HOUR; h <= MAX_NOTIFICATION_HOUR; h++) {
    const label = `${hourIcon(h)} ${formatNotificationHour(h)}`;
    kb.text(label, `set:notif:time:${h}`);
    if ((h + 1) % 4 === 0) kb.row();
  }
  kb.row();
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsNotifChooseTime", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:notif:time:{hour} — select a notification hour */
export async function handleSetNotifTimeSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const hourStr = data.replace("set:notif:time:", "");
  const hour = Number.parseInt(hourStr, 10);

  if (Number.isNaN(hour) || hour < MIN_NOTIFICATION_HOUR || hour > MAX_NOTIFICATION_HOUR) {
    await ctx.answerCallbackQuery({ text: "Invalid time", show_alert: true });
    return;
  }

  await ctx.services.notificationRepository.updatePrefs(ctx.user.id, {
    notificationTime: String(hour),
  });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: t("settingsNotifTime", lang, { time: formatNotificationHour(hour) }),
  });
  await showSettingsMenu(ctx);
}

/** set:notif:type — show notification type picker */
export async function handleSetNotifTypeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  const typeLabels: Record<string, string> = {
    srs: "📖 Dictionary (SRS)",
    suggested: "✨ AI suggestions",
    both: "🔀 Both",
  };
  for (const type of NOTIFICATION_TYPES) {
    kb.text(typeLabels[type] ?? type, `set:notif:type:${type}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsNotifChooseType", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:notif:type:{type} — select a notification type */
export async function handleSetNotifTypeSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const type = data.replace("set:notif:type:", "");

  await ctx.services.notificationRepository.updatePrefs(ctx.user.id, {
    notificationType: type as NotificationType,
  });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: t("settingsNotifType", lang, { type }),
  });
  await showSettingsMenu(ctx);
}

/** set:notif:tz — prompt for timezone input */
export async function handleSetNotifTzCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  // Show common timezones as inline buttons
  const commonTz = [
    "UTC",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Prague",
    "Europe/Moscow",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Asia/Shanghai",
  ];
  const kb = new InlineKeyboard();
  for (const tz of commonTz) {
    kb.text(tz, `set:notif:tz:${tz}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await ctx.editMessageText(t("settingsNotifChooseTimezone", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:notif:tz:{timezone} — select a timezone */
export async function handleSetNotifTzSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const timezone = data.replace("set:notif:tz:", "");

  // Validate timezone by trying Intl
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    await ctx.answerCallbackQuery({
      text: "Invalid timezone",
      show_alert: true,
    });
    return;
  }

  // Update timezone via updateSettings — pass existing fields + new timezone
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  await ctx.services.userRepository.updateSettings(ctx.user.id, {
    interfaceLang: settings?.interfaceLang ?? "en",
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    timezone,
    activeMode: settings?.activeMode ?? "translate",
  });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: t("settingsNotifTimezone", lang, { timezone }),
  });
  await showSettingsMenu(ctx);
}

/** set:back — return to settings main menu */
export async function handleSetBackCallback(ctx: BotContext): Promise<void> {
  await showSettingsMenu(ctx);
  await ctx.answerCallbackQuery();
}

/** set:close — dismiss the settings menu */
export async function handleSetCloseCallback(ctx: BotContext): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // Message might be too old to delete — just remove keyboard
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  }
  await ctx.answerCallbackQuery();
}
