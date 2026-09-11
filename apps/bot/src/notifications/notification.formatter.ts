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
  esc,
  expandableSection,
  headwordLine,
  meaningLine,
} from "../renderers/card-sections.js";

/**
 * Format a notification payload as a Telegram HTML message.
 *
 * **A notification is a recall prompt, not a card.** It asks the word and hands
 * over nothing that answers it: no translation, no stored meaning, no secondary
 * languages, no provenance label. The reader tries to remember, then taps
 * "Reveal" to check themselves — which is what the notification is for. The card
 * it used to inline is one tap away, and reading it there is the moment of recall
 * the daily word exists to create.
 *
 * A pick that carries no dictionary entry (a curated preset, an AI suggestion, a
 * contextual sentence) has no Reveal button to tap, so for those the answer goes
 * into a collapsed expandable quote instead of vanishing. That also keeps them
 * out of `editMessageText` and so out of Telegram's 48-hour edit limit.
 *
 * `order` is required rather than derived here: the record arrives from the
 * scheduler through `jsonb`-shaped data, so its key order carries no meaning and
 * a caller that has the user's settings must say what the order is. See
 * `@polyglot/core`'s translation-order module.
 *
 * `footer` arrives already rendered so this stays pure: the motivation layer's
 * weekly line (Task 81, S4) needs a database read and a kill-switch check, and
 * omitting it must leave the card byte-identical to what it was before that layer
 * existed.
 */
export function formatNotificationMessage(
  payload: NotificationPayload,
  lang: SupportedLang,
  order: LanguageOrderContext,
  options: { footer?: string } = {},
): string {
  const { word } = payload;
  const revealable = word.entryId != null;

  return assembleCard({
    ...emptySections(),
    // Only for a word the reader never saved: without it an unfamiliar headword
    // arrives with nothing saying where it came from. Their own words need no label.
    provenance: revealable ? [] : [`<i>${esc(sourceLabel(word.source, lang))}</i>`],
    headword: [
      headwordLine(word.headword?.trim() || word.original, { emoji: word.emoji, sourceLang: word.sourceLang }),
    ],
    aids: recallAid(payload, lang, order, revealable),
    // Blank separator first: glued to the prompt the weekly line would read as
    // part of it rather than as the week's own tally.
    footer: options.footer ? ["", options.footer] : [],
  });
}

function sourceLabel(source: NotificationPayload["word"]["source"], lang: SupportedLang): string {
  switch (source) {
    case "srs":
      return t("notifWordFromDict", lang);
    case "preset":
      return t("notifPresetWord", lang);
    case "contextual":
      return t("notifTypeContextual", lang);
    default:
      return t("notifAiSuggested", lang);
  }
}

/**
 * The line that asks for the recall — and, when no Reveal button will follow it,
 * the answer folded into a collapsed quote below.
 *
 * Leads with a blank separator so the prompt reads as an instruction about the
 * word rather than as a second line of it.
 */
function recallAid(
  payload: NotificationPayload,
  lang: SupportedLang,
  order: LanguageOrderContext,
  revealable: boolean,
): string[] {
  if (revealable) {
    return ["", `<i>${esc(t("notifSelfCheck", lang))}</i>`];
  }
  const hidden = hiddenAnswer(payload, order);
  if (hidden.length === 0) return [];
  return ["", `<i>${esc(t("notifTapToReveal", lang))}</i>`, ...expandableSection(hidden)];
}

/**
 * The card that used to be inline: native answer first, then the other languages.
 * Every language gets the same answer line — a translation looks like a
 * translation wherever it sits.
 */
function hiddenAnswer(payload: NotificationPayload, order: LanguageOrderContext): string[] {
  const { word } = payload;
  // Ordered here, not trusted from the record: the native language ranks first,
  // and everything after it follows the user's own choice of learning languages.
  const [answer, ...others] = orderRecordEntries(word.translations, order);
  return [
    ...(answer ? [answerLine(answer[0], answer[1], word.translationDetails?.[answer[0]]?.synonyms ?? [])] : []),
    // Secondary languages stay to one line each — this is still a nudge, and the
    // synonyms behind them are the dictionary's job.
    ...others.map(([code, text]) => answerLine(code, text)),
    ...(word.nativeMeaning ? [meaningLine(word.nativeMeaning)] : []),
  ];
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
 * - grade row "Hard | OK | Easy" → notif:fb:{grade}:{entryId}
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
