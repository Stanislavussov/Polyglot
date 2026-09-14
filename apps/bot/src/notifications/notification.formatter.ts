/**
 * Notification message formatter — converts NotificationPayload to Telegram HTML.
 *
 * Rules:
 * 1. All texts via i18n — no hardcoded strings
 * 2. No business logic — only formatting
 * 3. No DB access — uses pre-built payload
 */
import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { type SupportedLang, t, type VocabDifficulty } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { assembleCard, emptySections, esc, headwordLine } from "../renderers/card-sections.js";
import { appendGradeRow, notifGradeCallback } from "../renderers/grade-row.js";

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
 * `footer` arrives already rendered so this stays pure: the motivation layer's
 * weekly line (Task 81, S4) needs a database read and a kill-switch check, and
 * omitting it must leave the card byte-identical to what it was before that layer
 * existed.
 */
export function formatNotificationMessage(
  payload: NotificationPayload,
  lang: SupportedLang,
  options: { footer?: string } = {},
): string {
  const { word } = payload;

  return assembleCard({
    ...emptySections(),
    headword: [
      headwordLine(word.headword?.trim() || word.original, { emoji: word.emoji, sourceLang: word.sourceLang }),
    ],
    // Blank separator first: glued to the word the prompt would read as a second
    // line of it rather than as an instruction about it.
    aids: ["", `<i>${esc(t("notifSelfCheck", lang))}</i>`],
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
