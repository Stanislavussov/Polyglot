/**
 * Flashcard renderer — Telegram-specific rendering of WordDisplayData
 * as HTML messages + inline keyboards.
 */

import type { SupportedLang, WordDisplayData } from "@polyglot/core";
import { getLangFlag, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";

/** Escape HTML special characters for Telegram */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Resolve a string to SupportedLang with "en" fallback */
function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

/**
 * Render the FRONT of a flash card (original word, no translations).
 * Shown before user taps "Reveal".
 */
export function renderFlashCardFront(
  word: WordDisplayData,
  cardIndex: number,
  totalCards: number,
  lang: SupportedLang,
): string {
  const lines: string[] = [];
  lines.push(esc(t("flashcardProgress", lang, { current: String(cardIndex), total: String(totalCards) })));
  lines.push("");
  lines.push(`${esc(word.emoji)} <b>${esc(word.original)}</b>`);
  const flag = getLangFlag(word.sourceLang) ?? "🔤";
  lines.push(`<i>${esc(word.inputType)} · ${flag}</i>`);
  return lines.join("\n");
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
): string {
  const lines: string[] = [];

  // Header — same as front
  lines.push(esc(t("flashcardProgress", lang, { current: String(cardIndex), total: String(totalCards) })));
  lines.push("");
  lines.push(`${esc(word.emoji)} <b>${esc(word.original)}</b>`);
  const srcFlag = getLangFlag(word.sourceLang) ?? "🔤";
  lines.push(`<i>${esc(word.inputType)} · ${srcFlag}</i>`);
  lines.push("");

  // Translations
  for (const [code, tr] of Object.entries(word.translations)) {
    const flag = getLangFlag(code) ?? "🔤";
    const header = tr.transcription ? `<b>${esc(tr.text)}</b> [${esc(tr.transcription)}]` : `<b>${esc(tr.text)}</b>`;
    lines.push(`${flag} ${header}`);

    // CEFR + register on same line
    const meta: string[] = [];
    if (tr.register) meta.push(esc(tr.register));
    if (tr.cefr) meta.push(esc(tr.cefr));
    if (meta.length > 0) lines.push(meta.join(" · "));

    // Synonyms
    if (tr.synonyms && tr.synonyms.length > 0) {
      lines.push(`(${tr.synonyms.map((s) => esc(s.text)).join(", ")})`);
    }

    // Examples
    if (tr.examples && tr.examples.length > 0) {
      for (const ex of tr.examples) {
        const registerLabel = ex.register ? `  → ${esc(ex.register)}` : "";
        lines.push(`💬 <i>${esc(ex.target)}</i>${registerLabel}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trim();
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
