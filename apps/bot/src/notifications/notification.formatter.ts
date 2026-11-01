/**
 * Notification message formatter — converts NotificationPayload to Telegram HTML.
 *
 * Rules:
 * 1. All texts via i18n — no hardcoded strings
 * 2. No business logic — only formatting
 * 3. No DB access — uses pre-built payload
 */
import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { type I18nKey, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { assembleCard, emptySections, esc, headwordLine } from "../renderers/card-sections.js";

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

export interface NotificationMessageOptions {
  footer?: string;
  /** Index into `SELF_CHECK_KEYS`, wrapped; absent renders the first question. */
  selfCheckVariant?: number;
}

/**
 * A word that is not in the reader's dictionary (a curated preset, an AI suggestion,
 * a contextual sentence): the headword and a recall question. There is nothing to
 * schedule, so Reveal translates it (`notif:tr`) — a word from the dictionary is a
 * card instead (`formatCardNotification`).
 *
 * The headword is the citation form when one was stored, with its source flag.
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
  const question = selfCheckQuestion(options.selfCheckVariant);

  return assembleCard({
    ...emptySections(),
    headword: [
      headwordLine(word.headword?.trim() || word.original, { emoji: word.emoji, sourceLang: word.sourceLang }),
    ],
    // Blank separator: glued to the word the prompt would read as a second line of it.
    aids: ["", `<i>${esc(t(question, lang))}</i>`],
    // Blank separator first: glued to the prompt the weekly line would read as
    // part of it rather than as the week's own tally.
    footer: options.footer ? ["", options.footer] : [],
  });
}

function selfCheckQuestion(variant: number | undefined): (typeof SELF_CHECK_KEYS)[number] {
  const count = SELF_CHECK_KEYS.length;
  return SELF_CHECK_KEYS[(((variant ?? 0) % count) + count) % count]!;
}

/**
 * A word from the reader's dictionary is a card (Task 86): the front exactly as `/review`
 * shows it (`front` arrives rendered with the reader's card settings), then the recall
 * question. Reveal opens it as a Cards deck, so it is rated with the same four ratings.
 * With more than one card the count leads, because it is what a push preview shows.
 */
export function formatCardNotification(
  front: string,
  size: number,
  lang: SupportedLang,
  options: NotificationMessageOptions = {},
): string {
  return assembleCard({
    ...emptySections(),
    chrome: size > 1 ? [esc(t("notifDeckTitle", lang, { count: size })), ""] : [],
    headword: [front],
    aids: ["", `<i>${esc(t(selfCheckQuestion(options.selfCheckVariant), lang))}</i>`],
    footer: options.footer ? ["", options.footer] : [],
  });
}

/** Opens the notification settings screen as a message of its own; the notification stays as it was. */
export const NOTIF_SETTINGS_CALLBACK = "notif:settings";

function appendSettingsRow(kb: InlineKeyboard, lang: SupportedLang): InlineKeyboard {
  return kb.row().text(t("notifSettingsButton", lang), NOTIF_SETTINGS_CALLBACK);
}

/** For a notification with nothing else to tap — the lapsed-user message, the empty-dictionary prompt. */
export function buildNotificationSettingsKeyboard(lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard().text(t("notifSettingsButton", lang), NOTIF_SETTINGS_CALLBACK);
}

/**
 * Build the inline keyboard for a notification message, last row always the settings.
 *
 * A dictionary word is a card, so it gets the `/review` front's buttons: Reveal
 * (`notif:deck`, which opens the deck) and Remove (`notif:learned`, kept from the
 * old nudge so its restore flow and the buttons already in chat history still land).
 * A word with no entry has nothing to rate or remove, so Reveal translates it.
 */
export function buildNotificationKeyboard(lang: SupportedLang, entryId?: number): InlineKeyboard {
  if (entryId == null) {
    return appendSettingsRow(new InlineKeyboard().text(t("notifReveal", lang), "notif:tr"), lang);
  }
  const kb = new InlineKeyboard()
    .text(t("flashcardReveal", lang), `notif:deck:${entryId}`)
    .row()
    .text(t("notifFbDelete", lang), `notif:learned:${entryId}`);
  return appendSettingsRow(kb, lang);
}

/** The one button a removal confirmation carries: the way back. */
export function buildNotificationRestoreKeyboard(lang: SupportedLang, entryId: number): InlineKeyboard {
  return new InlineKeyboard().text(t("undoRemoveWord", lang), `notif:restore:${entryId}`);
}
