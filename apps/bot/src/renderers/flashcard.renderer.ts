/**
 * Cards renderer — one translation row per card, as HTML + inline keyboards.
 */

import type {
  CardFrontFields,
  CardsDeckCard,
  I18nKey,
  LanguageOrderContext,
  SrsRating,
  SupportedLang,
  VocabularyEntryWithTranslations,
} from "@polyglot/core";
import { t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import { PROGRESS_FLASHCARD_DONE_CALLBACK } from "../momentum/progress.command.js";
import { esc } from "./card-sections.js";
import { renderDictionaryEntry } from "./dictionary.renderer.js";
import { renderCardFront, renderWordCard } from "./word-card.js";

function progressLine(current: number, total: number, lang: SupportedLang): string {
  return esc(t("flashcardProgress", lang, { current, total }));
}

/** The word plus what the user's card settings allow — see `renderCardFront` for why nothing else may appear. */
export function renderFlashCardFront(
  card: CardsDeckCard,
  sourceLangCode: string,
  current: number,
  total: number,
  lang: SupportedLang,
  fields: CardFrontFields,
): string {
  const front = renderCardFront(
    { original: card.original, emoji: card.emoji, sourceLang: sourceLangCode, sourceUsage: card.sourceUsage },
    fields,
  );
  const chrome = [progressLine(current, total, lang)];
  if (card.ahead) chrome.push(esc(t("cardsAheadNote", lang)));
  return [...chrome, "", front].join("\n");
}

function backScreen(body: string, current: number, total: number, lang: SupportedLang): string {
  return [progressLine(current, total, lang), "", body, "", esc(t("srsChooseRating", lang))].join("\n");
}

/**
 * The answer: the saved word exactly as the dictionary shows it — every stored
 * language, the reader's own promoted under the headword.
 *
 * It *is* the dictionary card, by construction rather than by resemblance: the
 * deck used to project one translation row into a card of its own, so a word
 * saved in three languages answered in one of them and looked like a different
 * word on every surface it came back on.
 */
export function renderFlashCardBack(
  entry: VocabularyEntryWithTranslations,
  langResolver: (id: number) => string | undefined,
  current: number,
  total: number,
  lang: SupportedLang,
  order: LanguageOrderContext,
): string {
  return backScreen(renderDictionaryEntry(entry, langResolver, lang, order), current, total, lang);
}

/**
 * The deck card's own row alone — the entry is gone from the dictionary, or was
 * never this reader's. The rating buttons still have to work, so the card answers
 * from what the session holds instead of leaving a revealed card blank.
 */
export function renderFlashCardBackFromCard(
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
      answerLang: targetLangCode,
    },
    lang,
  );
  return backScreen(back, current, total, lang);
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

export function buildFlashCardFrontKeyboard(lang: SupportedLang, entryId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("flashcardReveal", lang), "fc:reveal")
    .text(t("flashcardQuitBtn", lang), "fc:quit")
    .row()
    .text(t("notifFbDelete", lang), deleteCallback(entryId));
}

/**
 * `cardActions` are the ordinary card's buttons (`card-keyboard.ts`), shown under
 * the ratings: a reviewed word offers what a freshly translated one offers. The
 * ratings stay first — they answer the question the card just asked.
 */
export function buildFlashCardBackKeyboard(
  lang: SupportedLang,
  card: Pick<CardsDeckCard, "translationId" | "entryId">,
  cardActions: InlineKeyboardButton[][] = [],
): InlineKeyboard {
  const kb = new InlineKeyboard();
  rateButton(kb, lang, "again", card.translationId);
  rateButton(kb, lang, "hard", card.translationId).row();
  rateButton(kb, lang, "good", card.translationId);
  rateButton(kb, lang, "easy", card.translationId).row();
  for (const row of cardActions) {
    kb.add(...row).row();
  }
  return kb
    .text(t("notifFbDelete", lang), deleteCallback(card.entryId))
    .row()
    .text(t("flashcardQuitBtn", lang), "fc:quit");
}

/** The 📈 screen renders nothing while the kill switch is off, so the switch gates the button too — not just the handler. */
export function buildFlashCardDoneKeyboard(lang: SupportedLang, options: { showProgress: boolean }): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text(t("flashcardNewDeckBtn", lang), "fc:restart")
    .text(t("flashcardClose", lang), "fc:close");
  // Own row: a third button beside these two makes Telegram squeeze all three
  // captions to unreadable width (Task 81 §6, Slice 2).
  if (options.showProgress) kb.row().text(t("progressButton", lang), PROGRESS_FLASHCARD_DONE_CALLBACK);
  return kb;
}
