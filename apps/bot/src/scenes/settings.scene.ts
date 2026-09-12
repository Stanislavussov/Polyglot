/**
 * Settings scene — /settings command handler.
 * Main menu shows language config + notification status line.
 * Notification details are in a sub-menu (set:notif).
 * Callback handlers are in helpers/settings.helper.ts.
 */
import {
  evaluatePlanRateLimit,
  formatNotificationTime,
  getLangDisplay,
  getMonthlyWindowReset,
  getMonthlyWindowStart,
  isSupported,
  type PlanLimitConfig,
  parseNotificationMinutes,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { canUseChangesCommand } from "../commands/changes.js";
import type { BotContext } from "../types.js";
import { resolvePlanLimit } from "../utils/plan-limit.js";
import { editMessageTextOrReply } from "./helpers/edit-message.helper.js";

/** Format a list of "HH:MM" times as a sorted, normalized, comma-separated string ("—" when empty). */
export function formatNotificationTimes(times: string[]): string {
  if (times.length === 0) return "—";
  return [...times]
    .map(parseNotificationMinutes)
    .sort((a, b) => a - b)
    .map(formatNotificationTime)
    .join(", ");
}

/**
 * Localized label for a notification type.
 *
 * The stored value is the enum (`srs`), which used to reach the screen verbatim —
 * both here and in the sub-menu — so the type line read "Type — srs" in every language.
 */
export function notifTypeLabel(type: string, lang: SupportedLang): string {
  switch (type) {
    case "srs":
      return t("notifTypeSrs", lang);
    case "suggested":
      return t("notifTypeSuggested", lang);
    case "contextual":
      return t("notifTypeContextual", lang);
    default:
      return type;
  }
}

/**
 * Build the settings main menu text.
 *
 * Every line is `Label — value`, with no per-line icon: the screen is a list of five
 * answers to the same question, and an icon on each one made them read as five unrelated
 * features. Icons live on the buttons below instead, where they mark a tap target. Flags
 * stay — they identify a language, they do not decorate it.
 */
export function buildSettingsText(
  nativeLang: string,
  learningLangs: string[],
  interfaceLang: string,
  lang: SupportedLang,
  notifEnabled?: boolean,
  notifTimes?: string[],
  notifType?: string,
  planUsage?: string,
): string {
  const notifStatus = notifEnabled
    ? `${t("settingsNotifEnabled", lang)} · ${formatNotificationTimes(notifTimes ?? [])} · ${notifTypeLabel(notifType ?? "srs", lang)}`
    : t("settingsNotifDisabled", lang);

  return [
    t("settingsTitle", lang),
    "",
    t("settingsNativeLang", lang, { lang: getLangDisplay(nativeLang) }),
    t("settingsLearningLangs", lang, {
      langs: learningLangs.map(getLangDisplay).join(", ") || "—",
    }),
    t("settingsInterfaceLang", lang, { lang: getLangDisplay(interfaceLang) }),
    planUsage ?? "",
    "",
    notifStatus,
  ].join("\n");
}

/**
 * Build the settings root keyboard.
 *
 * One row per subject rather than one row per field: the three language pickers used
 * to sit here side by side with notifications, so changing a notification time meant
 * reading past two questions about languages first. `showChanges` follows
 * `canUseChangesCommand` — the changelog is an internal tool and the button is absent,
 * not disabled, for everyone else.
 */
export function buildSettingsKeyboard(lang: SupportedLang, options: { showChanges?: boolean } = {}): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t("settingsGroupLanguages", lang), "set:lang").row();
  kb.text(t("settingsNotifManage", lang), "set:notif").row();
  kb.text(t("settingsGroupTemplate", lang), "set:tpl").row();
  kb.text(t("settingsGroupPlan", lang), "set:plan").row();
  if (options.showChanges) {
    kb.text(t("settingsGroupChanges", lang), "set:changes").row();
  }
  kb.text(t("settingsClose", lang), "set:close").row();
  return kb;
}

/**
 * Build the language sub-menu keyboard.
 *
 * `set:back` from a picker lands here rather than at the settings root, so the three
 * questions stay one level apart from everything else.
 */
export function buildLangGroupKeyboard(lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t("settingsChangeNative", lang), "set:native").row();
  kb.text(t("settingsChangeLearning", lang), "set:learning").row();
  kb.text(t("settingsChangeInterface", lang), "set:interface").row();
  kb.text(`⬅️ ${t("back", lang)}`, "set:root").row();
  return kb;
}

/**
 * Build the notification sub-menu text with all details.
 */
export function buildNotifSubText(
  lang: SupportedLang,
  notifEnabled: boolean,
  notifTimes: string[],
  notifType: string,
  timezone: string,
  notifContext: string | null,
): string {
  const statusLine = notifEnabled ? t("settingsNotifStatusOn", lang) : t("settingsNotifStatusOff", lang);

  const lines = [
    t("settingsNotifSubTitle", lang),
    "",
    statusLine,
    t("settingsNotifTimes", lang, { times: formatNotificationTimes(notifTimes) }),
    t("settingsNotifType", lang, { type: notifTypeLabel(notifType, lang) }),
    t("settingsNotifTimezone", lang, { timezone }),
  ];

  if (notifType === "contextual") {
    lines.push(
      t("settingsNotifContext", lang, {
        context: notifContext || t("settingsNotifContextNotSet", lang),
      }),
    );
  }

  return lines.join("\n");
}

/**
 * Build the notification sub-menu keyboard.
 */
export function buildNotifSubKeyboard(lang: SupportedLang, notifEnabled: boolean, notifType: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(notifEnabled ? t("settingsNotifDisable", lang) : t("settingsNotifEnable", lang), "set:notif:toggle").row();
  if (notifEnabled) {
    kb.text(t("settingsNotifChooseTimes", lang), "set:notif:time").row();
    kb.text(t("settingsNotifChooseType", lang), "set:notif:type").row();
    kb.text(t("settingsNotifChooseTimezone", lang), "set:notif:tz").row();
    if (notifType === "contextual") {
      kb.text(t("settingsNotifChooseContext", lang), "set:notif:context").row();
    }
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:notif:back").row();
  return kb;
}

/**
 * The settings root as text + keyboard.
 *
 * Shared by the command and the in-place re-render so the two cannot drift: they used to
 * be separate bodies, and one of them counted credits over a DAILY window while both
 * formatted the number against the MONTHLY limit — so re-rendering the screen silently
 * inflated the remaining balance.
 */
async function loadSettingsView(ctx: BotContext): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  const plan = ctx.user.subscriptionPlan ?? "free";
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(
    ctx.user.id,
    getMonthlyWindowStart(),
  );
  const planLimit = await resolvePlanLimit(ctx.services.settings, plan);

  return {
    text: buildSettingsText(
      settings?.nativeLang ?? "en",
      settings?.learningLangs ?? [],
      settings?.interfaceLang ?? "en",
      lang,
      settings?.notificationEnabled ?? false,
      settings?.notificationTimes ?? [],
      settings?.notificationType ?? "srs",
      formatPlanUsageFromConfig(planLimit, usedCredits, lang),
    ),
    keyboard: buildSettingsKeyboard(lang, { showChanges: canUseChangesCommand(ctx.user.audienceGroup) }),
  };
}

/** /settings command handler — answers with a message of its own. */
export async function handleSettingsCommand(ctx: BotContext): Promise<void> {
  const { text, keyboard } = await loadSettingsView(ctx);
  await ctx.reply(text, { reply_markup: keyboard, parse_mode: "HTML" });
}

/** Re-renders the settings root over the message the tap came from. */
export async function renderSettingsInPlace(ctx: BotContext): Promise<void> {
  const { text, keyboard } = await loadSettingsView(ctx);
  await editMessageTextOrReply(ctx, text, { reply_markup: keyboard, parse_mode: "HTML" });
}

export function formatPlanUsageFromConfig(plan: PlanLimitConfig, usedCredits: number, lang: SupportedLang): string {
  const status = evaluatePlanRateLimit(
    { plan: plan.name, label: plan.label, creditsPerDay: plan.translationLimit },
    usedCredits,
    0,
    getMonthlyWindowReset(),
  );
  if (plan.translationLimit === null) {
    return t("settingsPlanUnlimited", lang, { plan: plan.label });
  }
  return t("settingsPlan", lang, {
    plan: plan.label,
    remaining: status.remainingCredits ?? 0,
    limit: plan.translationLimit,
  });
}
