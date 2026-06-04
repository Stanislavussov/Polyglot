import type { SrsDueVocabularyCard, SupportedLang } from "@polyglot/core";
import { getLangFlag, getLanguageName, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

export function renderSrsFront(
  card: SrsDueVocabularyCard,
  sourceLangCode: string,
  targetLangCode: string,
  current: number,
  total: number,
  lang: SupportedLang,
): string {
  const sourceFlag = getLangFlag(sourceLangCode) ?? "🔤";
  const targetFlag = getLangFlag(targetLangCode) ?? "🔤";
  const targetName = getLanguageName(targetLangCode);
  return [
    esc(t("srsProgress", lang, { current, total })),
    "",
    `${esc(card.emoji ?? "🔤")} <b>${esc(card.original)}</b>`,
    `<i>${esc(card.inputType)} · ${sourceFlag} → ${targetFlag} ${esc(targetName)}</i>`,
  ].join("\n");
}

export function renderSrsBack(
  card: SrsDueVocabularyCard,
  sourceLangCode: string,
  targetLangCode: string,
  current: number,
  total: number,
  lang: SupportedLang,
): string {
  const lines = [
    renderSrsFront(card, sourceLangCode, targetLangCode, current, total, lang),
    "",
    `${getLangFlag(targetLangCode) ?? "🔤"} <b>${esc(card.text)}</b>${
      card.transcription ? ` [${esc(card.transcription)}]` : ""
    }`,
  ];

  if (card.details?.examples && card.details.examples.length > 0) {
    const example = card.details.examples[0];
    if (example) {
      const native = example.native ? ` (${esc(example.native)})` : "";
      lines.push(`💬 <i>${esc(example.target)}</i>${native}`);
    }
  }

  lines.push("");
  lines.push(esc(t("srsChooseRating", lang)));
  return lines.join("\n");
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
