/**
 * Settings callback handlers — set:* callbacks.
 * Manages native/learning/interface language pickers, notification prefs, and close.
 */
import {
  formatNotificationTime,
  getDailyWindowStart,
  isSupported,
  logEvent,
  NOTIFICATION_TYPES,
  type NotificationType,
  parseNotificationMinutes,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { setUserCommands } from "../../commands/commands.js";
import { MAX_LEARNING_LANGS, MAX_NOTIFICATION_TIMES } from "../../constants.js";
import type { BotContext } from "../../types.js";
import { cleanupTechnicalMessages, replyTechnical } from "../../utils/message-cleanup.js";
import { resolvePlanLimit } from "../../utils/plan-limit.js";
import {
  buildNotifSubKeyboard,
  buildNotifSubText,
  buildSettingsKeyboard,
  buildSettingsText,
  formatPlanUsageFromConfig,
} from "../settings.scene.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "./edit-message.helper.js";

/** Resolve interface language from user settings */
async function getLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return (isSupported(iLang) ? iLang : "en") as SupportedLang;
}

/** Re-render the settings main menu */
async function showSettingsMenu(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const notifEnabled = settings?.notificationEnabled ?? false;
  const notifTimes = settings?.notificationTimes ?? [];
  const notifType = settings?.notificationType ?? "srs";
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(
    ctx.user.id,
    getDailyWindowStart(),
  );
  const planLimit = await resolvePlanLimit(ctx.services.settings, ctx.user.subscriptionPlan ?? "free");
  const planUsage = formatPlanUsageFromConfig(planLimit, usedCredits, lang);

  const text = buildSettingsText(
    settings?.nativeLang ?? "en",
    settings?.learningLangs ?? [],
    settings?.interfaceLang ?? "en",
    lang,
    notifEnabled,
    notifTimes,
    notifType,
    planUsage,
  );
  const kb = buildSettingsKeyboard(lang);
  await editMessageTextOrReply(ctx, text, { reply_markup: kb, parse_mode: "HTML" });
}

/** Re-render the notification sub-menu */
async function showNotifSubMenu(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const notifEnabled = settings?.notificationEnabled ?? false;
  const notifTimes = settings?.notificationTimes ?? [];
  const notifType = settings?.notificationType ?? "srs";
  const timezone = settings?.timezone ?? "UTC";
  const notifContext = settings?.notificationContext ?? null;

  const text = buildNotifSubText(lang, notifEnabled, notifTimes, notifType, timezone, notifContext);
  const kb = buildNotifSubKeyboard(lang, notifEnabled, notifType);
  await editMessageTextOrReply(ctx, text, { reply_markup: kb, parse_mode: "HTML" });
}

/** set:native — show native language picker */
export async function handleSetNativeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  for (const l of ctx.services.languageCache.getSupportedLangs()) {
    kb.text(ctx.services.languageCache.getLangDisplay(l.code), `set:native:${l.code}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await editMessageTextOrReply(ctx, t("settingsChooseNative", lang), {
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

  const previousNative = (await ctx.services.userRepository.getSettings(ctx.user.id))?.nativeLang ?? null;
  await ctx.services.userRepository.updateNativeLang(ctx.user.id, code);
  // Before/after, because a mis-set native language silently changes every
  // later translation direction and is invisible from the result alone.
  logEvent("settings.native_lang_changed", { from: previousNative, to: code });
  await ctx.answerCallbackQuery({
    text: t("settingsNativeUpdated", lang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
  });
  await cleanupTechnicalMessages(ctx);
  await showSettingsMenu(ctx);
}

/** set:learning — show learning language multi-select */
export async function handleSetLearningCallback(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = settings?.learningLangs ?? [];

  // The picker hides the native language; log the exact offered set so a future
  // "language X is missing" report can be traced to the excluded native.
  const offered = ctx.services.languageCache
    .getSupportedLangs()
    .map((l) => l.code)
    .filter((code) => code !== nativeLang);
  logEvent("settings.learning_picker_opened", { nativeLang, selected, offered }, "debug");

  const kb = buildLearningKeyboard(ctx, selected, nativeLang, lang);
  await editMessageTextOrReply(ctx, t("settingsChooseLearning", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** CEFR proficiency levels offered when adding a learning language. */
const PROFICIENCY_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

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
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();
  return kb;
}

/** Build the CEFR level picker shown after a new learning language is chosen. */
function buildLevelKeyboard(code: string, lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const level of PROFICIENCY_LEVELS) {
    kb.text(level, `set:learn:lvl:${code}:${level}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:learning").row();
  return kb;
}

/**
 * set:learn:{code} — tap a learning language.
 * Removing an already-selected language is immediate; adding a new one first
 * asks for its CEFR level, and the language is saved only once the level is
 * confirmed (see handleSetLearnLevelCallback).
 */
export async function handleSetLearnToggleCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const code = data.replace("set:learn:", "");

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = [...(settings?.learningLangs ?? [])];

  const idx = selected.indexOf(code);
  if (idx >= 0) {
    // Already a learning language → remove it immediately.
    selected.splice(idx, 1);
    await ctx.services.userRepository.updateLearningLangs(ctx.user.id, selected);
    logEvent("settings.learning_lang_removed", { langCode: code, learningLangs: selected });
    await ctx.answerCallbackQuery({
      text: t("langRemoved", lang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
    });
    const kb = buildLearningKeyboard(ctx, selected, nativeLang, lang);
    await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: kb });
    return;
  }

  if (selected.length >= MAX_LEARNING_LANGS) {
    await ctx.answerCallbackQuery({
      text: t("maxLangsReached", lang, { max: MAX_LEARNING_LANGS }),
      show_alert: true,
    });
    return;
  }

  // New language → ask for the proficiency level before saving.
  await ctx.answerCallbackQuery();
  const langName = ctx.services.languageCache.getLangDisplay(code);
  await editMessageTextOrReply(ctx, t("chooseProficiencyLevel", lang, { lang: langName }), {
    reply_markup: buildLevelKeyboard(code, lang),
    parse_mode: "HTML",
  });
}

/** set:learn:lvl:{code}:{level} — confirm level and save the new learning language. */
export async function handleSetLearnLevelCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const [, , , code, level] = data.split(":");

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const selected = [...(settings?.learningLangs ?? [])];

  if (!code || !level) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (!selected.includes(code)) {
    if (selected.length >= MAX_LEARNING_LANGS) {
      await ctx.answerCallbackQuery({
        text: t("maxLangsReached", lang, { max: MAX_LEARNING_LANGS }),
        show_alert: true,
      });
      return;
    }
    selected.push(code);
    await ctx.services.userRepository.updateLearningLangs(ctx.user.id, selected);
  }
  await ctx.services.userRepository.setLanguageLevel(ctx.user.id, code, level);
  logEvent("settings.learning_lang_added", { langCode: code, level, learningLangs: selected });

  await ctx.answerCallbackQuery({
    text: t("langAdded", lang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
  });
  await editMessageTextOrReply(ctx, t("settingsChooseLearning", lang), {
    reply_markup: buildLearningKeyboard(ctx, selected, nativeLang, lang),
    parse_mode: "HTML",
  });
}

/** set:interface — show interface language picker */
export async function handleSetInterfaceCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  for (const l of ctx.services.languageCache.getSupportedLangs()) {
    kb.text(ctx.services.languageCache.getLangDisplay(l.code), `set:iface:${l.code}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:back").row();

  await editMessageTextOrReply(ctx, t("settingsChooseInterface", lang), {
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
  logEvent("settings.interface_lang_changed", { to: code });

  const newLang = (isSupported(code) ? code : "en") as SupportedLang;
  await ctx.answerCallbackQuery({
    text: t("settingsInterfaceUpdated", newLang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
  });

  const chatId = ctx.from?.id;
  if (chatId) {
    await setUserCommands(ctx.api, chatId, newLang, ctx.user.audienceGroup);
  }

  await cleanupTechnicalMessages(ctx);
  await showSettingsMenu(ctx);
}

/** set:notif — show notification sub-menu */
export async function handleSetNotifCallback(ctx: BotContext): Promise<void> {
  await showNotifSubMenu(ctx);
  await ctx.answerCallbackQuery();
}

/** set:notif:toggle — enable/disable notifications */
export async function handleSetNotifToggleCallback(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const currentEnabled = settings?.notificationEnabled ?? false;
  const newEnabled = !currentEnabled;

  const prefs: { notificationEnabled: boolean; notificationTimes?: string[] } = {
    notificationEnabled: newEnabled,
  };

  // Seed the admin-managed default the first time someone turns notifications on
  // without a schedule. An empty list means "not configured" — this is the only
  // place it is ever filled in automatically, and only when it is empty, so a
  // time the user picked is never overwritten. The settings read happens INSIDE
  // this branch on purpose: it keeps toggle-off free of a settings round trip.
  if (newEnabled && (settings?.notificationTimes?.length ?? 0) === 0) {
    const defaults = await ctx.services.settings.getNotificationDefaults();
    // Canonicalize rather than trusting the stored string: getWithFallback heals
    // *missing* keys only, so a present-but-malformed admin value would otherwise
    // land in user data verbatim.
    prefs.notificationTimes = [formatNotificationTime(parseNotificationMinutes(defaults.defaultTime))];
  }

  await ctx.services.notificationRepository.updatePrefs(ctx.user.id, prefs);
  logEvent("settings.notifications_toggled", { from: currentEnabled, to: newEnabled });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: newEnabled ? t("settingsNotifEnabled", lang) : t("settingsNotifDisabled", lang),
  });
  await cleanupTechnicalMessages(ctx);
  await showNotifSubMenu(ctx);
}

/** Build emoji icon for a given hour */
function hourIcon(hour: number): string {
  if (hour >= 6 && hour < 12) return "🌅";
  if (hour >= 12 && hour < 18) return "☀️";
  if (hour >= 18 && hour < 22) return "🌙";
  return "🌑";
}

/** Build the multi-select 30-min grid, marking currently-selected slots with ✅ */
function buildNotifTimesKeyboard(selected: Set<number>, lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let slot = 0; slot < 48; slot++) {
    const totalMinutes = slot * 30;
    // Replace the time-of-day icon with ✅ when selected, so the label width
    // stays the same (one glyph + time) and the time isn't truncated.
    const icon = selected.has(totalMinutes) ? "✅" : hourIcon(Math.floor(totalMinutes / 60));
    const label = `${icon} ${formatNotificationTime(totalMinutes)}`;
    kb.text(label, `set:notif:time:${totalMinutes}`);
    if ((slot + 1) % 4 === 0) kb.row();
  }
  kb.row();
  kb.text(t("done", lang), "set:notif").row();
  return kb;
}

/** set:notif:time — show the multi-select notification time grid */
export async function handleSetNotifTimeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const selected = new Set((settings?.notificationTimes ?? []).map(parseNotificationMinutes));

  await editMessageTextOrReply(ctx, t("settingsNotifChooseTimes", lang), {
    reply_markup: buildNotifTimesKeyboard(selected, lang),
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:notif:time:{minutes} — toggle a notification time on/off (multi-select) */
export async function handleSetNotifTimeSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const minutesStr = data.replace("set:notif:time:", "");
  const totalMinutes = Number.parseInt(minutesStr, 10);
  const lang = await getLang(ctx);

  if (Number.isNaN(totalMinutes) || totalMinutes < 0 || totalMinutes > 23 * 60 + 30) {
    await ctx.answerCallbackQuery({ text: "Invalid time", show_alert: true });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const selected = new Set((settings?.notificationTimes ?? []).map(parseNotificationMinutes));
  const timeStr = formatNotificationTime(totalMinutes);

  if (selected.has(totalMinutes)) {
    // Refuse to empty the schedule. An empty list means "not configured", so the
    // next toggle off→on would seed the admin default — scheduling the user at a
    // time they never picked. Auto-disabling notifications instead would park
    // them in exactly that state, so the guard refuses rather than disables, and
    // points at the toggle that already exists. This must run BEFORE the
    // `answerCallbackQuery` below: Telegram accepts one answer per query, so
    // answering twice would show "Removed 08:00" for a slot that was kept.
    if (selected.size === 1) {
      await ctx.answerCallbackQuery({ text: t("settingsNotifTimesMin", lang), show_alert: true });
      return;
    }
    selected.delete(totalMinutes);
    await ctx.answerCallbackQuery({ text: t("settingsNotifTimeRemoved", lang, { time: timeStr }) });
  } else if (selected.size >= MAX_NOTIFICATION_TIMES) {
    await ctx.answerCallbackQuery({
      text: t("settingsNotifTimesMax", lang, { max: MAX_NOTIFICATION_TIMES }),
      show_alert: true,
    });
    return;
  } else {
    selected.add(totalMinutes);
    await ctx.answerCallbackQuery({ text: t("settingsNotifTimeAdded", lang, { time: timeStr }) });
  }

  const times = [...selected].sort((a, b) => a - b).map(formatNotificationTime);
  await ctx.services.notificationRepository.updatePrefs(ctx.user.id, { notificationTimes: times });
  logEvent("settings.notification_times_changed", { times });

  await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: buildNotifTimesKeyboard(selected, lang) });
}

/** set:notif:type — show notification type picker */
export async function handleSetNotifTypeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const kb = new InlineKeyboard();
  const typeLabels: Record<string, string> = {
    srs: t("notifTypeSrs", lang),
    suggested: t("notifTypeSuggested", lang),
    contextual: t("notifTypeContextual", lang),
  };
  for (const type of NOTIFICATION_TYPES) {
    kb.text(typeLabels[type] ?? type, `set:notif:type:${type}`).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:notif:back").row();

  await editMessageTextOrReply(ctx, t("settingsNotifChooseType", lang), {
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
  logEvent("settings.notification_type_changed", { to: type });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: t("settingsNotifType", lang, { type }),
  });
  await cleanupTechnicalMessages(ctx);
  await showNotifSubMenu(ctx);
}

/** set:notif:tz — prompt for timezone input */
export async function handleSetNotifTzCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
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
  kb.text(`⬅️ ${t("back", lang)}`, "set:notif:back").row();

  await editMessageTextOrReply(ctx, t("settingsNotifChooseTimezone", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** set:notif:tz:{timezone} — select a timezone */
export async function handleSetNotifTzSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const timezone = data.replace("set:notif:tz:", "");

  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    await ctx.answerCallbackQuery({
      text: "Invalid timezone",
      show_alert: true,
    });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  await ctx.services.userRepository.updateSettings(ctx.user.id, {
    interfaceLang: settings?.interfaceLang ?? "en",
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    timezone,
    activeMode: settings?.activeMode ?? "translate",
  });
  logEvent("settings.timezone_changed", { from: settings?.timezone ?? null, to: timezone });

  const lang = await getLang(ctx);
  await ctx.answerCallbackQuery({
    text: t("settingsNotifTimezone", lang, { timezone }),
  });
  await cleanupTechnicalMessages(ctx);
  await showNotifSubMenu(ctx);
}

/** set:notif:context — prompt user to send context text */
export async function handleSetNotifContextCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const currentContext = settings?.notificationContext ?? null;

  ctx.session.awaitingNotifContext = true;

  const kb = new InlineKeyboard();
  kb.text(t("settingsNotifContextCancel", lang), "set:notif:context:cancel").row();

  await editMessageTextOrReply(
    ctx,
    t("settingsNotifContextPrompt", lang, {
      current: currentContext || t("settingsNotifContextNotSet", lang),
    }),
    { reply_markup: kb, parse_mode: "HTML" },
  );
  await ctx.answerCallbackQuery();
}

/** set:notif:context:cancel — cancel context editing */
export async function handleSetNotifContextCancelCallback(ctx: BotContext): Promise<void> {
  ctx.session.awaitingNotifContext = false;
  await showNotifSubMenu(ctx);
  await ctx.answerCallbackQuery();
}

/** Handle text input when awaiting notification context */
export async function handleNotifContextTextInput(ctx: BotContext): Promise<void> {
  const text = ctx.message?.text?.trim();
  if (!text) return;

  ctx.session.awaitingNotifContext = false;

  await ctx.services.notificationRepository.updatePrefs(ctx.user.id, {
    notificationContext: text,
  });
  logEvent("settings.notification_context_changed", { context: text });

  const lang = await getLang(ctx);
  // No sweep here: this only ever runs on a text message, which the central
  // cleanup middleware already swept, and repeating it would delete the
  // confirmation that was just sent.
  await replyTechnical(ctx, t("settingsNotifContextSaved", lang, { context: text }), { parse_mode: "HTML" });
  await showNotifSubMenu(ctx);
}

/** set:notif:back — return to settings main menu from notif sub-menu */
export async function handleSetNotifBackCallback(ctx: BotContext): Promise<void> {
  await showSettingsMenu(ctx);
  await ctx.answerCallbackQuery();
}

/** set:back — return to settings main menu */
export async function handleSetBackCallback(ctx: BotContext): Promise<void> {
  await showSettingsMenu(ctx);
  await ctx.answerCallbackQuery();
}

/** set:close — dismiss the settings menu */
export async function handleSetCloseCallback(ctx: BotContext): Promise<void> {
  await cleanupTechnicalMessages(ctx);
  try {
    await ctx.deleteMessage();
  } catch {
    await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
  }
  await ctx.answerCallbackQuery();
}
