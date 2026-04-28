/**
 * Notification message formatter — converts NotificationPayload to Telegram HTML.
 *
 * Rules:
 * 1. All texts via i18n — no hardcoded strings
 * 2. No business logic — only formatting
 * 3. No DB access — uses pre-built payload
 */
import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { getLangFlag, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";

/**
 * Format a notification payload as a Telegram HTML message.
 *
 * Layout:
 * - Emoji + original word (bold)
 * - Source label (dictionary or AI)
 * - Translations per language with flag emoji
 */
export function formatNotificationMessage(
  payload: NotificationPayload,
  lang: SupportedLang,
): string {
  const { word } = payload;
  const sourceLabel =
    word.source === "srs"
      ? t("notifWordFromDict", lang)
      : t("notifAiSuggested", lang);

  const translationLines = Object.entries(word.translations)
    .map(([code, text]) => {
      const flag = getLangFlag(code) ?? "🔤";
      return `  ${flag} ${text}`;
    })
    .join("\n");

  const lines = [
    `${word.emoji} <b>${escapeHtml(word.original)}</b>`,
    `<i>${sourceLabel}</i>`,
    "",
    `${t("notifTranslations", lang)}`,
    translationLines,
  ];

  return lines.join("\n");
}

/**
 * Build the inline keyboard for a notification message.
 *
 * Buttons:
 * - "📖 Open dictionary" → notif:open
 * - "⏭ Skip" → notif:skip
 */
export function buildNotificationKeyboard(lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("notifOpenDict", lang), "notif:open")
    .text(t("notifSkip", lang), "notif:skip");
}

/** Escape HTML entities in user/AI content */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
