/**
 * Flashcard renderer — Telegram-specific rendering of WordDisplayData
 * as HTML messages + inline keyboards.
 */

import type { LanguageOrderContext, SupportedLang, WordDisplayData } from "@polyglot/core";
import { isSupported, orderRecordEntries, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { esc } from "./card-sections.js";
import { citationOnly, renderWordCard } from "./word-card.js";

/** Resolve a string to SupportedLang with "en" fallback */
function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

function progressLine(cardIndex: number, totalCards: number, lang: SupportedLang): string {
  return esc(t("flashcardProgress", lang, { current: String(cardIndex), total: String(totalCards) }));
}

/**
 * Render the FRONT of a flash card (original word, no translations).
 * Shown before user taps "Reveal".
 *
 * The saved source examples stay off the front: their native gloss would hand the
 * reader the answer they are here to recall.
 */
export function renderFlashCardFront(
  word: WordDisplayData,
  cardIndex: number,
  totalCards: number,
  lang: SupportedLang,
): string {
  const card = renderWordCard(
    {
      original: word.original,
      emoji: word.emoji,
      sourceLang: word.sourceLang,
      nativeMeaning: word.nativeMeaning,
      sourceUsage: citationOnly(word.sourceUsage),
      langs: [],
    },
    lang,
  );
  return [progressLine(cardIndex, totalCards, lang), "", card].join("\n");
}

/**
 * Render the BACK of a flash card (original word + all translations).
 * Shown after user taps "Reveal".
 */
export function renderFlashCardBack(
  word: WordDisplayData,
  cardIndex: number,
  totalCards: number,
  lang: SupportedLang,
  order: LanguageOrderContext,
): string {
  const card = renderWordCard(
    {
      original: word.original,
      emoji: word.emoji,
      sourceLang: word.sourceLang,
      nativeMeaning: word.nativeMeaning,
      sourceUsage: word.sourceUsage,
      // The deck is held in the session to render without re-fetching, so this
      // record has been through jsonb and its keys come back alphabetized.
      langs: orderRecordEntries(word.translations, order).map(([code, tr]) => ({
        code,
        text: tr.text,
        synonyms: tr.synonyms,
        examples: tr.examples,
        usageNote: tr.usageNote,
      })),
      answerLang: order.nativeLang,
      nativeLang: order.nativeLang,
    },
    lang,
  );
  return [progressLine(cardIndex, totalCards, lang), "", card].join("\n");
}

/** Build the keyboard for the front of a card (before reveal) */
export function buildFlashCardFrontKeyboard(lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard().text(t("flashcardReveal", l), "fc:reveal").text(t("flashcardQuitBtn", l), "fc:quit");
}

/** Build the keyboard for the back of a card (after reveal) */
export function buildFlashCardBackKeyboard(isLastCard: boolean, lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  if (isLastCard) {
    return new InlineKeyboard().text(t("flashcardDoneBtn", l), "fc:done").text(t("flashcardRestart", l), "fc:restart");
  }
  return new InlineKeyboard().text(t("flashcardNext", l), "fc:next").text(t("flashcardQuitBtn", l), "fc:quit");
}

/** Build the keyboard for the session-complete screen */
export function buildFlashCardDoneKeyboard(lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard().text(t("flashcardNewDeckBtn", l), "fc:restart").text(t("flashcardClose", l), "fc:close");
}
