/**
 * Settings scene — /settings command handler.
 * Main menu shows language config + notification status line.
 * Notification details are in a sub-menu (set:notif).
 * Callback handlers are in helpers/settings.helper.ts.
 */
import { formatNotificationTime, getLangDisplay, parseNotificationMinutes, userRepository } from "@polyglot/adapter-db";
import {
  evaluatePlanRateLimit,
  evaluateRateLimit,
  getDailyWindowReset,
  getDailyWindowStart,
  getPlanLimit,
  isSupported,
  type PlanLimitConfig,
  type SubscriptionPlan,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { trackTechnicalMessage } from "../utils/message-cleanup.js";
import type { BotContext } from "../types.js";

/**
 * Build the settings main menu text.
 * Notifications shown as a single status line.
 */
export function buildSettingsText(
  nativeLang: string,
  learningLangs: string[],
  interfaceLang: string,
  lang: SupportedLang,
  notifEnabled?: boolean,
  notifTime?: string,
  notifType?: string,
  planUsage?: string,
): string {
  const notifStatus = notifEnabled
    ? `🔔 ${t("settingsNotifEnabled", lang)} · ${formatNotificationTime(parseNotificationMinutes(notifTime))} · ${notifType ?? "srs"}`
    : `🔕 ${t("settingsNotifDisabled", lang)}`;

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
 * Build the settings main menu keyboard.
 */
export function buildSettingsKeyboard(lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t("settingsChangeNative", lang), "set:native").row();
  kb.text(t("settingsChangeLearning", lang), "set:learning").row();
  kb.text(t("settingsChangeInterface", lang), "set:interface").row();
  kb.text(t("settingsNotifManage", lang), "set:notif").row();
  kb.text(t("settingsClose", lang), "set:close").row();
  return kb;
}

/**
 * Build the notification sub-menu text with all details.
 */
export function buildNotifSubText(
  lang: SupportedLang,
  notifEnabled: boolean,
  notifTime: string,
  notifType: string,
  timezone: string,
  notifContext: string | null,
): string {
  const statusLine = notifEnabled ? t("settingsNotifStatusOn", lang) : t("settingsNotifStatusOff", lang);

  const lines = [
    t("settingsNotifSubTitle", lang),
    "",
    statusLine,
    t("settingsNotifTime", lang, { time: formatNotificationTime(parseNotificationMinutes(notifTime)) }),
    t("settingsNotifType", lang, { type: notifType }),
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
    kb.text(t("settingsNotifChooseTime", lang), "set:notif:time").row();
    kb.text(t("settingsNotifChooseType", lang), "set:notif:type").row();
    kb.text(t("settingsNotifChooseTimezone", lang), "set:notif:tz").row();
    if (notifType === "contextual") {
      kb.text(t("settingsNotifChooseContext", lang), "set:notif:context").row();
    }
  }
  kb.text(`⬅️ ${t("back", lang)}`, "set:notif:back").row();
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
  const notifEnabled = settings?.notificationEnabled ?? false;
  const notifTime = settings?.notificationTime ?? "08:00";
  const notifType = settings?.notificationType ?? "srs";
  const plan = ctx.user.subscriptionPlan ?? "free";
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(
    ctx.user.id,
    getDailyWindowStart(),
  );
  const planLimit = (await ctx.services.settings?.getPlanLimit(plan)) ?? null;
  const planUsage = planLimit
    ? formatPlanUsageFromConfig(planLimit, usedCredits, lang)
    : formatPlanUsage(plan, usedCredits, lang);

  const text = buildSettingsText(
    nativeLang,
    learningLangs,
    interfaceLang,
    lang,
    notifEnabled,
    notifTime,
    notifType,
    planUsage,
  );
  const kb = buildSettingsKeyboard(lang);

  const msg = await ctx.reply(text, { reply_markup: kb, parse_mode: "HTML" });
  trackTechnicalMessage(ctx, msg.message_id);
}

export function formatPlanUsage(plan: SubscriptionPlan, usedCredits: number, lang: SupportedLang): string {
  const limit = getPlanLimit(plan);
  const status = evaluateRateLimit(plan, usedCredits, 0, getDailyWindowReset());
  if (limit.creditsPerDay === null) {
    return t("settingsPlanUnlimited", lang, { plan: limit.label });
  }
  return t("settingsPlan", lang, {
    plan: limit.label,
    remaining: status.remainingCredits ?? 0,
    limit: limit.creditsPerDay,
  });
}

export function formatPlanUsageFromConfig(plan: PlanLimitConfig, usedCredits: number, lang: SupportedLang): string {
  const status = evaluatePlanRateLimit(
    { plan: plan.name, label: plan.label, creditsPerDay: plan.creditsPerDay },
    usedCredits,
    0,
    getDailyWindowReset(),
  );
  if (plan.creditsPerDay === null) {
    return t("settingsPlanUnlimited", lang, { plan: plan.label });
  }
  return t("settingsPlan", lang, {
    plan: plan.label,
    remaining: status.remainingCredits ?? 0,
    limit: plan.creditsPerDay,
  });
}
