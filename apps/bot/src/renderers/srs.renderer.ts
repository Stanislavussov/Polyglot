import type { CardFrontFields, SrsDueVocabularyCard, SupportedLang } from "@polyglot/core";
import { getLangFlag, getLanguageName, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { PROGRESS_SRS_DONE_CALLBACK } from "../momentum/progress.command.js";
import { esc } from "./card-sections.js";
import { renderCardFront, renderWordCard } from "./word-card.js";

function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

/**
 * Progress plus the recall direction. The direction is not decoration: the same
 * word is reviewed once per target language, so the card has to say which one is
 * being asked for.
 */
function chromeLines(targetLangCode: string, current: number, total: number, lang: SupportedLang): string[] {
  const targetFlag = getLangFlag(targetLangCode) ?? "🔤";
  return [
    esc(t("srsProgress", lang, { current, total })),
    `<i>→ ${targetFlag} ${esc(getLanguageName(targetLangCode))}</i>`,
  ];
}

export function renderSrsFront(
  card: SrsDueVocabularyCard,
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
  return [...chromeLines(targetLangCode, current, total, lang), "", front].join("\n");
}

export function renderSrsBack(
  card: SrsDueVocabularyCard,
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

/** Carries the entry id so a stale card's button cannot remove the word the session has moved on to. */
export function srsDeleteCallback(entryId: number): string {
  return `srs:del:${entryId}`;
}

export function buildSrsFrontKeyboard(lang: SupportedLang, entryId: number): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("srsReveal", l), "srs:reveal")
    .text(t("srsQuitBtn", l), "srs:quit")
    .row()
    .text(t("notifFbDelete", l), srsDeleteCallback(entryId));
}

export function buildSrsBackKeyboard(lang: SupportedLang, entryId: number): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("srsAgain", l), "srs:rate:again")
    .text(t("srsHard", l), "srs:rate:hard")
    .row()
    .text(t("srsGood", l), "srs:rate:good")
    .text(t("srsEasy", l), "srs:rate:easy")
    .row()
    .text(t("notifFbDelete", l), srsDeleteCallback(entryId))
    .row()
    .text(t("srsQuitBtn", l), "srs:quit");
}

/** The 📈 screen renders nothing while the kill switch is off, so the switch gates the button too — not just the handler. */
export function buildSrsDoneKeyboard(lang: SupportedLang, options: { showProgress: boolean }): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard().text(t("srsNewSessionBtn", l), "srs:restart").text(t("srsClose", l), "srs:close");
  // Own row: a third button beside these two makes Telegram squeeze all three
  // captions to unreadable width (Task 81 §6, Slice 2).
  if (options.showProgress) kb.row().text(t("progressButton", l), PROGRESS_SRS_DONE_CALLBACK);
  return kb;
}
