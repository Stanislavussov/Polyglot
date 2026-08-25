import type { SrsDueVocabularyCard, SupportedLang } from "@polyglot/core";
import { getLangFlag, getLanguageName, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { PROGRESS_SRS_DONE_CALLBACK } from "../momentum/progress.command.js";
import { formatInputType } from "./input-type-label.js";
import { renderCompactSourceExample } from "./source-usage.renderer.js";

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
  const lines = [
    esc(t("srsProgress", lang, { current, total })),
    "",
    `${esc(card.emoji ?? "🔤")} <b>${esc(card.original)}</b>`,
  ];
  if (card.nativeMeaning) {
    lines.push(esc(card.nativeMeaning));
  }
  lines.push(`<i>${esc(formatInputType(card.inputType, lang))} · ${sourceFlag} → ${targetFlag} ${esc(targetName)}</i>`);
  return lines.join("\n");
}

export function renderSrsBack(
  card: SrsDueVocabularyCard,
  sourceLangCode: string,
  targetLangCode: string,
  current: number,
  total: number,
  lang: SupportedLang,
): string {
  const lines = [renderSrsFront(card, sourceLangCode, targetLangCode, current, total, lang), ""];

  const sourceExample = renderCompactSourceExample(sourceLangCode, card.sourceUsage);
  if (sourceExample) {
    lines.push(sourceExample, "");
  }

  lines.push(`${getLangFlag(targetLangCode) ?? "🔤"} ${esc(targetLangCode.toUpperCase())}: <b>${esc(card.text)}</b>`);

  if (card.usageNote) {
    lines.push(`💡 ${esc(card.usageNote)}`);
  }

  if (card.connotationWarning) {
    lines.push(`⚠️ ${esc(card.connotationWarning)}`);
  }

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

/** The 📈 screen renders nothing while the kill switch is off, so the switch gates the button too — not just the handler. */
export function buildSrsDoneKeyboard(lang: SupportedLang, options: { showProgress: boolean }): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard().text(t("srsNewSessionBtn", l), "srs:restart").text(t("srsClose", l), "srs:close");
  // Own row: a third button beside these two makes Telegram squeeze all three
  // captions to unreadable width (Task 81 §6, Slice 2).
  if (options.showProgress) kb.row().text(t("progressButton", l), PROGRESS_SRS_DONE_CALLBACK);
  return kb;
}
