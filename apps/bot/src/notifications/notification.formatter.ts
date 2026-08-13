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
export function formatNotificationMessage(payload: NotificationPayload, lang: SupportedLang): string {
  const { word } = payload;
  const sourceLabel =
    word.source === "srs"
      ? t("notifWordFromDict", lang)
      : word.source === "preset"
        ? t("notifPresetWord", lang)
        : word.source === "contextual"
          ? t("notifTypeContextual", lang)
          : t("notifAiSuggested", lang);

  const translationLines = Object.entries(word.translations)
    .map(([code, text]) => {
      const flag = getLangFlag(code) ?? "🔤";
      const lines = [`  ${flag} ${escapeHtml(code.toUpperCase())}: ${escapeHtml(text)}`];
      const details = word.translationDetails?.[code];
      if (details?.synonyms && details.synonyms.length > 0) {
        const synonymText = details.synonyms.map(escapeHtml).join(", ");
        lines.push(`    ≈ ${synonymText}`);
      }
      return lines.join("\n");
    })
    .join("\n");

  const lines = [
    `${word.emoji} <b>${escapeHtml(word.original)}</b>`,
    ...(word.nativeMeaning ? [escapeHtml(word.nativeMeaning)] : []),
    `<i>${sourceLabel}</i>`,
    "",
    `${t("notifTranslations", lang)}`,
    translationLines,
  ];

  return lines.join("\n");
}

/**
 * Build the inline keyboard for a notification message (initial state).
 *
 * Buttons:
 * - "🔍 Reveal" → notif:reveal:{entryId}
 * - "✅ Learned — remove" → notif:learned:{entryId}
 */
export function buildNotificationKeyboard(lang: SupportedLang, entryId?: number): InlineKeyboard {
  if (entryId == null) {
    // Contextual/AI notifications without a dictionary entry — no actions
    return new InlineKeyboard();
  }
  return new InlineKeyboard()
    .text(t("notifReveal", lang), `notif:reveal:${entryId}`)
    .row()
    .text(t("notifLearned", lang), `notif:learned:${entryId}`);
}

/**
 * Build the inline keyboard for a revealed notification (after "Reveal" tap).
 *
 * Buttons:
 * - "✅ Learned — remove" → notif:learned:{entryId}
 */
export function buildNotificationRevealedKeyboard(lang: SupportedLang, entryId: number): InlineKeyboard {
  return new InlineKeyboard().text(t("notifLearned", lang), `notif:learned:${entryId}`);
}

/** Escape HTML entities in user/AI content */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
