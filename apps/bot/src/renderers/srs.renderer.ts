import type { SrsDueVocabularyCard, SupportedLang } from "@polyglot/core";
import { getLangFlag, getLanguageName, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { esc } from "./card-sections.js";
import { citationOnly, renderWordCard } from "./word-card.js";

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
): string {
  // No saved source usage on the front — its examples carry native translations,
  // which is the answer being asked for.
  const front = renderWordCard(
    {
      original: card.original,
      emoji: card.emoji,
      sourceLang: sourceLangCode,
      nativeMeaning: card.nativeMeaning,
      sourceUsage: citationOnly(card.sourceUsage),
      langs: [],
    },
    lang,
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

export function buildSrsFrontKeyboard(lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard().text(t("srsReveal", l), "srs:reveal").text(t("srsQuitBtn", l), "srs:quit");
}

export function buildSrsBackKeyboard(lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("srsAgain", l), "srs:rate:again")
    .text(t("srsHard", l), "srs:rate:hard")
    .row()
    .text(t("srsGood", l), "srs:rate:good")
    .text(t("srsEasy", l), "srs:rate:easy")
    .row()
    .text(t("srsQuitBtn", l), "srs:quit");
}

export function buildSrsDoneKeyboard(lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard().text(t("srsNewSessionBtn", l), "srs:restart").text(t("srsClose", l), "srs:close");
}
