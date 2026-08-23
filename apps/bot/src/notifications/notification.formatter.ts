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

/** Feedback grade a user can give a notification word. Drives pick frequency. */
export type NotifFeedbackGrade = "hard" | "normal" | "easy";

const FEEDBACK_GRADES: Array<{ grade: NotifFeedbackGrade; labelKey: "notifFbHard" | "notifFbNormal" | "notifFbEasy" }> =
  [
    { grade: "hard", labelKey: "notifFbHard" },
    { grade: "normal", labelKey: "notifFbNormal" },
    { grade: "easy", labelKey: "notifFbEasy" },
  ];

/**
 * Append the feedback menu: one row of grades (the chosen one marked with a
 * leading check so a later tap can still re-grade), then the remove row.
 *
 * Remove deliberately keeps the legacy `notif:learned` callback so buttons on
 * already-sent messages keep hitting a registered handler.
 */
function appendFeedbackMenu(
  kb: InlineKeyboard,
  lang: SupportedLang,
  entryId: number,
  selected?: NotifFeedbackGrade,
): InlineKeyboard {
  for (const { grade, labelKey } of FEEDBACK_GRADES) {
    const label = t(labelKey, lang);
    kb.text(grade === selected ? `✓ ${label}` : label, `notif:fb:${grade}:${entryId}`);
  }
  return kb.row().text(t("notifFbDelete", lang), `notif:learned:${entryId}`);
}

/**
 * Build the inline keyboard for a notification message (initial state).
 *
 * Buttons:
 * - "🔍 Reveal" → notif:reveal:{entryId}
 * - grade row "Hard | Normal | I know it" → notif:fb:{grade}:{entryId}
 * - "🗑 Remove from dictionary" → notif:learned:{entryId}
 */
export function buildNotificationKeyboard(
  lang: SupportedLang,
  entryId?: number,
  selected?: NotifFeedbackGrade,
): InlineKeyboard {
  if (entryId == null) {
    // Contextual/AI notifications without a dictionary entry — no actions
    return new InlineKeyboard();
  }
  const kb = new InlineKeyboard().text(t("notifReveal", lang), `notif:reveal:${entryId}`).row();
  return appendFeedbackMenu(kb, lang, entryId, selected);
}

/**
 * Build the inline keyboard for a revealed notification (after "Reveal" tap).
 * Same feedback menu as the initial keyboard, without the Reveal button.
 */
export function buildNotificationRevealedKeyboard(
  lang: SupportedLang,
  entryId: number,
  selected?: NotifFeedbackGrade,
): InlineKeyboard {
  return appendFeedbackMenu(new InlineKeyboard(), lang, entryId, selected);
}
