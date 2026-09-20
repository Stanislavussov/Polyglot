/**
 * Cards renderer — one translation row per card, as HTML + inline keyboards.
 */

import type { CardFrontFields, CardsDeckCard, I18nKey, SrsRating, SupportedLang } from "@polyglot/core";
import { getLangFlag, getLanguageName, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { PROGRESS_FLASHCARD_DONE_CALLBACK } from "../momentum/progress.command.js";
import { esc } from "./card-sections.js";
import { renderCardFront, renderWordCard } from "./word-card.js";

/**
 * Progress plus the recall direction. The direction is not decoration: a word saved
 * in several languages is asked in one of them per card, so the card has to say which.
 */
function chromeLines(targetLangCode: string, current: number, total: number, lang: SupportedLang): string[] {
  const targetFlag = getLangFlag(targetLangCode) ?? "🔤";
  return [
    esc(t("flashcardProgress", lang, { current, total })),
    `<i>→ ${targetFlag} ${esc(getLanguageName(targetLangCode))}</i>`,
  ];
}

/** The word plus what the user's card settings allow — see `renderCardFront` for why nothing else may appear. */
export function renderFlashCardFront(
  card: CardsDeckCard,
  sourceLangCode: string,
  targetLangCode: string,
  current: number,
  total: number,
  lang: SupportedLang,
  fields: CardFrontFields,
): string {
  const front = renderCardFront(
    { original: card.original, emoji: card.emoji, sourceLang: sourceLangCode, sourceUsage: card.sourceUsage },
    fields,
  );
  const chrome = chromeLines(targetLangCode, current, total, lang);
  if (card.ahead) chrome.push(esc(t("cardsAheadNote", lang)));
  return [...chrome, "", front].join("\n");
}

export function renderFlashCardBack(
  card: CardsDeckCard,
  sourceLangCode: string,
  targetLangCode: string,
  current: number,
  total: number,
  lang: SupportedLang,
): string {
  const back = renderWordCard(
    {
      original: card.original,
      emoji: card.emoji,
      sourceLang: sourceLangCode,
      nativeMeaning: card.nativeMeaning,
      sourceUsage: card.sourceUsage,
      langs: [
        {
          code: targetLangCode,
          text: card.text,
          synonyms: card.details?.synonyms,
          examples: card.details?.examples,
          usageNote: card.usageNote,
          connotationWarning: card.connotationWarning,
        },
      ],
      // The reader is recalling the target language, so that block is the answer.
      answerLang: targetLangCode,
    },
    lang,
  );
  return [...chromeLines(targetLangCode, current, total, lang), "", back, "", esc(t("srsChooseRating", lang))].join(
    "\n",
  );
}

export function renderFlashCardDone(lang: SupportedLang, counts: { cards: number; recalled: number }): string {
  return t("cardsDone", lang, counts);
}

const RATING_LABELS: Record<SrsRating, I18nKey> = {
  again: "srsAgain",
  hard: "srsHard",
  good: "srsGood",
  easy: "srsEasy",
};

/** The translation id rides in the data so a button left on an older card cannot rate the card now on screen. */
function rateButton(kb: InlineKeyboard, lang: SupportedLang, rating: SrsRating, translationId: number): InlineKeyboard {
  return kb.text(t(RATING_LABELS[rating], lang), `fc:rate:${rating}:${translationId}`);
}

function deleteCallback(entryId: number): string {
  return `fc:del:${entryId}`;
}

/** Own row: it is about the word just removed, not the card it sits under. */
function appendUndoRow(kb: InlineKeyboard, lang: SupportedLang, undoEntryId: number | undefined): InlineKeyboard {
  return undoEntryId === undefined ? kb : kb.row().text(t("undoRemoveWord", lang), `fc:undo:${undoEntryId}`);
}

export function buildFlashCardFrontKeyboard(
  lang: SupportedLang,
  entryId: number,
  undoEntryId?: number,
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t("flashcardReveal", lang), "fc:reveal")
    .text(t("flashcardQuitBtn", lang), "fc:quit")
    .row()
    .text(t("notifFbDelete", lang), deleteCallback(entryId));
  return appendUndoRow(kb, lang, undoEntryId);
}

export function buildFlashCardBackKeyboard(
  lang: SupportedLang,
  card: Pick<CardsDeckCard, "translationId" | "entryId">,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  rateButton(kb, lang, "again", card.translationId);
  rateButton(kb, lang, "hard", card.translationId).row();
  rateButton(kb, lang, "good", card.translationId);
  rateButton(kb, lang, "easy", card.translationId).row();
  return kb
    .text(t("notifFbDelete", lang), deleteCallback(card.entryId))
    .row()
    .text(t("flashcardQuitBtn", lang), "fc:quit");
}

/** The 📈 screen renders nothing while the kill switch is off, so the switch gates the button too — not just the handler. */
export function buildFlashCardDoneKeyboard(
  lang: SupportedLang,
  options: { showProgress: boolean; undoEntryId?: number },
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t("flashcardNewDeckBtn", lang), "fc:restart")
    .text(t("flashcardClose", lang), "fc:close");
  // Own row: a third button beside these two makes Telegram squeeze all three
  // captions to unreadable width (Task 81 §6, Slice 2).
  if (options.showProgress) kb.row().text(t("progressButton", lang), PROGRESS_FLASHCARD_DONE_CALLBACK);
  return appendUndoRow(kb, lang, options.undoEntryId);
}
