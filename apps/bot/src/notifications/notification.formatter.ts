/**
 * Notification message formatter — converts NotificationPayload to Telegram HTML.
 *
 * Rules:
 * 1. All texts via i18n — no hardcoded strings
 * 2. No business logic — only formatting
 * 3. No DB access — uses pre-built payload
 */
import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { type LanguageOrderContext, orderRecordEntries, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import {
  answerLine,
  assembleCard,
  emptySections,
  headwordLine,
  meaningLine,
  otherLangLine,
} from "../renderers/card-sections.js";

/**
 * Format a notification payload as a Telegram HTML message.
 *
 * Sections, per the shared card grammar (`card-sections.ts`):
 * provenance → headword → answer → meaning → other languages.
 *
 * The answer is the line the reader came for, so it sits directly under the
 * headword. It previously landed on line 6, below the stored meaning and two
 * lines of chrome, which read as "my own language is last".
 *
 * `order` is required rather than derived here: the record arrives from the
 * scheduler through `jsonb`-shaped data, so its key order carries no meaning and
 * a caller that has the user's settings must say what the order is. See
 * `@polyglot/core`'s translation-order module.
 */
export function formatNotificationMessage(
  payload: NotificationPayload,
  lang: SupportedLang,
  order: LanguageOrderContext,
): string {
  const { word } = payload;
  const sourceLabel =
    word.source === "srs"
      ? t("notifWordFromDict", lang)
      : word.source === "preset"
        ? t("notifPresetWord", lang)
        : word.source === "contextual"
          ? t("notifTypeContextual", lang)
          : t("notifAiSuggested", lang);

  // Ordered here, not trusted from the record: the native language ranks first,
  // and everything after it follows the user's own choice of learning languages.
  const ordered = orderRecordEntries(word.translations, order);
  const [answer, ...others] = ordered;

  return assembleCard({
    ...emptySections(),
    // Above the headword: it labels the whole card ("from your dictionary")
    // rather than competing with the answer for the reader's attention.
    provenance: [`<i>${sourceLabel}</i>`],
    headword: [headwordLine(word.original, { emoji: word.emoji })],
    answer: answer ? [answerLine(answer[0], answer[1], word.translationDetails?.[answer[0]]?.synonyms ?? [])] : [],
    meaning: word.nativeMeaning ? [meaningLine(word.nativeMeaning)] : [],
    // Secondary languages stay to one line each — the card is a nudge, not a
    // dictionary entry, and the full detail is one "Reveal" tap away.
    others: others.map(([code, text]) => otherLangLine(code, text)),
  });
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
