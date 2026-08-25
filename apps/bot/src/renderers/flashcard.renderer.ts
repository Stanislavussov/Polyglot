/**
 * Flashcard renderer — Telegram-specific rendering of WordDisplayData
 * as HTML messages + inline keyboards.
 */

import type { LanguageOrderContext, SupportedLang, WordDisplayData } from "@polyglot/core";
import { getLangFlag, isSupported, orderRecordEntries, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { PROGRESS_FLASHCARD_DONE_CALLBACK } from "../momentum/progress.command.js";
import { expandableSection } from "./card-sections.js";
import { formatInputType } from "./input-type-label.js";
import { renderSourceUsage } from "./source-usage.renderer.js";

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
  if (word.nativeMeaning) {
    lines.push(esc(word.nativeMeaning));
  }
  const flag = getLangFlag(word.sourceLang) ?? "🔤";
  lines.push(`<i>${esc(formatInputType(word.inputType, lang))} · ${flag}</i>`);
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
  order: LanguageOrderContext,
): string {
  const lines: string[] = [];

  // Header — same as front
  lines.push(esc(t("flashcardProgress", lang, { current: String(cardIndex), total: String(totalCards) })));
  lines.push("");
  lines.push(`${esc(word.emoji)} <b>${esc(word.original)}</b>`);
  if (word.nativeMeaning) {
    lines.push(esc(word.nativeMeaning));
  }
  const srcFlag = getLangFlag(word.sourceLang) ?? "🔤";
  lines.push(`<i>${esc(formatInputType(word.inputType, lang))} · ${srcFlag}</i>`);
  lines.push("");

  const sourceUsage = renderSourceUsage(word.original, word.sourceLang, word.sourceUsage);
  if (sourceUsage.length > 0) {
    lines.push(...sourceUsage, "");
  }

  // Translations. The deck is held in the session to render without re-fetching,
  // so this record has been through jsonb and its keys come back alphabetized.
  for (const [code, tr] of orderRecordEntries(word.translations, order)) {
    const flag = getLangFlag(code) ?? "🔤";
    const header = `<b>${esc(tr.text)}</b>`;
    lines.push(`${flag} ${header}`);

    // Synonyms
    if (tr.synonyms && tr.synonyms.length > 0) {
      lines.push(`(${tr.synonyms.map((s) => esc(s.text)).join(", ")})`);
    }

    const notes: string[] = [];
    if (tr.examples && tr.examples.length > 0) {
      const [first, ...rest] = tr.examples.map(
        (ex) => `💬 <i>${esc(ex.target)}</i>${ex.native ? ` (${esc(ex.native)})` : ""}`,
      );
      lines.push(first!);
      notes.push(...rest);
    }
    if (tr.usageNote) {
      notes.push(`💡 ${esc(tr.usageNote)}`);
    }
    lines.push(...expandableSection(notes));

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

/**
 * Build the keyboard for the session-complete screen.
 *
 * `showProgress` is the motivation kill switch, read by the caller: the 📈 button
 * opens a screen that renders nothing while the switch is off, and a button that
 * leads nowhere is this project's known dead-button failure — so the switch has to
 * gate the button itself, not just the handler.
 */
export function buildFlashCardDoneKeyboard(lang: SupportedLang, options: { showProgress: boolean }): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard()
    .text(t("flashcardNewDeckBtn", l), "fc:restart")
    .text(t("flashcardClose", l), "fc:close");
  // Own row: a third button beside these two makes Telegram squeeze all three
  // captions to unreadable width (Task 81 §6, Slice 2).
  if (options.showProgress) kb.row().text(t("progressButton", l), PROGRESS_FLASHCARD_DONE_CALLBACK);
  return kb;
}
