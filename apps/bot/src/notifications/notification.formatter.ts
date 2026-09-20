/**
 * Notification message formatter — converts NotificationPayload to Telegram HTML.
 *
 * Rules:
 * 1. All texts via i18n — no hardcoded strings
 * 2. No business logic — only formatting
 * 3. No DB access — uses pre-built payload
 */
import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { type I18nKey, type SourceUsage, type SupportedLang, t, type VocabDifficulty } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { assembleCard, emptySections, esc, headwordLine } from "../renderers/card-sections.js";
import { appendGradeRow, notifGradeCallback } from "../renderers/grade-row.js";

/**
 * The recall questions a notification rotates through. One fixed sentence under a
 * new word every day stops being read within a week; the first entry is the
 * original question, so a render that picks no variant is unchanged.
 */
export const SELF_CHECK_KEYS = [
  "notifSelfCheck",
  "notifSelfCheck2",
  "notifSelfCheck3",
  "notifSelfCheck4",
  "notifSelfCheck5",
  "notifSelfCheck6",
  "notifSelfCheck7",
  "notifSelfCheck8",
  "notifSelfCheck9",
  "notifSelfCheck10",
  "notifSelfCheck11",
  "notifSelfCheck12",
] as const satisfies readonly I18nKey[];

/** A stored word's source-language synonyms as plain text, blanks dropped. */
export function sourceSynonymTexts(usage: SourceUsage | null | undefined): string[] {
  return (usage?.synonyms ?? []).map((synonym) => synonym.text.trim()).filter((text) => text !== "");
}

export interface NotificationMessageOptions {
  footer?: string;
  /** Index into `SELF_CHECK_KEYS`, wrapped; absent renders the first question. */
  selfCheckVariant?: number;
  /** Source-language synonyms, when the user's notification template switched them on. */
  synonyms?: readonly string[];
}

/**
 * Format a notification payload as a Telegram HTML message.
 *
 * **A notification is a recall prompt, not a card.** It is the headword and one
 * line asking whether the reader still knows it — no translation, no stored
 * meaning, no secondary languages, no label saying where the word came from. The
 * reader tries to remember, then taps Reveal, and what opens is the card the word
 * was translated on, buttons and all (`notification.callbacks.ts`). Everything
 * this message used to inline is there, and reading it there is the moment of
 * recall the daily word exists to create.
 *
 * The headword is the citation form when one was stored, with its source flag, so
 * the nudge and the card behind it introduce the same word the same way.
 *
 * Synonyms go below the question, never beside the word: a phone's push preview
 * shows only the first lines, and there the word and the question must survive.
 * They are source-language synonyms, so they help recall without answering it.
 *
 * `footer` arrives already rendered so this stays pure: the motivation layer's
 * weekly line (Task 81, S4) needs a database read and a kill-switch check, and
 * omitting it must leave the card byte-identical to what it was before that layer
 * existed.
 */
export function formatNotificationMessage(
  payload: NotificationPayload,
  lang: SupportedLang,
  options: NotificationMessageOptions = {},
): string {
  const { word } = payload;
  const count = SELF_CHECK_KEYS.length;
  const variant = options.selfCheckVariant ?? 0;
  const question = SELF_CHECK_KEYS[((variant % count) + count) % count]!;
  const synonyms = options.synonyms ?? [];

  return assembleCard({
    ...emptySections(),
    headword: [
      headwordLine(word.headword?.trim() || word.original, { emoji: word.emoji, sourceLang: word.sourceLang }),
    ],
    // Blank separators: glued to the word the prompt would read as a second line
    // of it, and glued to the prompt the synonyms would read as its answer.
    aids: [
      "",
      `<i>${esc(t(question, lang))}</i>`,
      ...(synonyms.length > 0 ? ["", t("notifSynonymsLine", lang, { synonyms: synonyms.map(esc).join(", ") })] : []),
    ],
    // Blank separator first: glued to the prompt the weekly line would read as
    // part of it rather than as the week's own tally.
    footer: options.footer ? ["", options.footer] : [],
  });
}

/** Feedback grade a user can give a notification word. Drives pick frequency. */
export type NotifFeedbackGrade = VocabDifficulty;

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
  appendGradeRow(kb, lang, (grade) => notifGradeCallback(grade, entryId), selected);
  return kb.row().text(t("notifFbDelete", lang), `notif:learned:${entryId}`);
}

/**
 * Build the inline keyboard for a notification message.
 *
 * Buttons:
 * - "🔍 Reveal" → notif:reveal:{entryId}, or `notif:tr` for a word with no entry
 * - grade row "Hard | OK | Easy" → notif:fb:{grade}:{entryId}
 * - "🗑 Remove from dictionary" → notif:learned:{entryId}
 *
 * The grades are here before the reveal and on the revealed card after it (the
 * card's `recallGrade` state): a reader who only knows how hard the word was once
 * the answer is in front of them must still be able to say so.
 *
 * A pick with no dictionary entry (a curated preset, an AI suggestion, a
 * contextual sentence) has nothing to grade or remove, so it gets the Reveal
 * button alone — pointed at `notif:tr`, which translates the word instead of
 * opening a row that does not exist.
 */
export function buildNotificationKeyboard(
  lang: SupportedLang,
  entryId?: number,
  selected?: NotifFeedbackGrade,
): InlineKeyboard {
  if (entryId == null) {
    return new InlineKeyboard().text(t("notifReveal", lang), "notif:tr");
  }
  const kb = new InlineKeyboard().text(t("notifReveal", lang), `notif:reveal:${entryId}`).row();
  return appendFeedbackMenu(kb, lang, entryId, selected);
}

/** The one button a removal confirmation carries: the way back. */
export function buildNotificationRestoreKeyboard(lang: SupportedLang, entryId: number): InlineKeyboard {
  return new InlineKeyboard().text(t("undoRemoveWord", lang), `notif:restore:${entryId}`);
}
