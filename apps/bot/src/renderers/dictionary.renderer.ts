/**
 * Dictionary renderer — Telegram-specific rendering for dictionary browse UI.
 *
 * Provides paginated list view, single entry detail view, and inline keyboards.
 * All text via i18n. HTML parse mode.
 */

import type { VocabTranslationDetails, VocabularyEntryWithTranslations } from "@polyglot/adapter-db";
import type { SupportedLang } from "@polyglot/core";
import { getLangFlag, isSupported, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";

/** Page size for dictionary list */
export const DICTIONARY_PAGE_SIZE = 15;

/** Max length for original word in list view before truncation */
const MAX_WORD_LENGTH = 30;

/** Escape HTML special characters for Telegram */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Resolve a string to SupportedLang with "en" fallback */
function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

/** Truncate text to maxLen with ellipsis */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

/**
 * Render the paginated dictionary list as HTML.
 */
export function renderDictionaryList(
  entries: VocabularyEntryWithTranslations[],
  page: number,
  totalPages: number,
  totalWords: number,
  lang: SupportedLang,
): string {
  const l = toLang(lang);
  const lines: string[] = [];

  lines.push(esc(t("dictionaryHeader", l, { count: String(totalWords) })));
  lines.push("");

  const startIndex = (page - 1) * DICTIONARY_PAGE_SIZE;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const idx = startIndex + i + 1;
    const emoji = entry.emoji ?? "";
    const original = truncate(entry.original, MAX_WORD_LENGTH);

    // Show up to 2 translation texts, plus "+N" if more
    const translationTexts = entry.translations.map((tr) => tr.text);
    let translationSummary: string;
    if (translationTexts.length <= 2) {
      translationSummary = translationTexts.map((t) => esc(t)).join(", ");
    } else {
      const shown = translationTexts
        .slice(0, 2)
        .map((t) => esc(t))
        .join(", ");
      translationSummary = `${shown}, +${translationTexts.length - 2}`;
    }

    const wordPart = emoji ? `${emoji} <b>${esc(original)}</b>` : `<b>${esc(original)}</b>`;
    const line = translationSummary ? `${idx}. ${wordPart} — ${translationSummary}` : `${idx}. ${wordPart}`;
    lines.push(line);
  }

  if (totalPages > 1) {
    lines.push("");
    lines.push(
      esc(
        t("dictionaryPage", l, {
          page: String(page),
          total: String(totalPages),
        }),
      ),
    );
  }

  return lines.join("\n");
}

/**
 * Render a single dictionary entry detail view as HTML.
 */
export function renderDictionaryEntry(
  entry: VocabularyEntryWithTranslations,
  langResolver: (id: number) => string | undefined,
): string {
  const lines: string[] = [];

  // Header
  const emoji = entry.emoji ?? "";
  const header = emoji ? `${emoji} <b>${esc(entry.original)}</b>` : `<b>${esc(entry.original)}</b>`;
  lines.push(header);

  // Source language flag + input type
  const sourceLangCode = langResolver(entry.sourceLangId);
  const srcFlag = sourceLangCode ? (getLangFlag(sourceLangCode) ?? "🔤") : "🔤";
  lines.push(`<i>${esc(entry.inputType)} · ${srcFlag}</i>`);

  // Translations
  for (const tr of entry.translations) {
    lines.push("");
    const langCode = langResolver(tr.targetLangId);
    const flag = langCode ? (getLangFlag(langCode) ?? "🔤") : "🔤";

    // Translation header with transcription
    const transcriptionPart = tr.transcription ? ` [${esc(tr.transcription)}]` : "";
    lines.push(`${flag} <b>${esc(tr.text)}</b>${transcriptionPart}`);

    // Details from JSONB
    const details = tr.details as VocabTranslationDetails | null;
    if (details) {
      // Synonyms
      if (details.synonyms && details.synonyms.length > 0) {
        lines.push(`(${details.synonyms.map((s) => esc(s.text)).join(", ")})`);
      }

      // Examples
      if (details.examples && details.examples.length > 0) {
        for (const ex of details.examples) {
          lines.push(`💬 <i>${esc(ex.target)}</i>`);
        }
      }
    }
  }

  return lines.join("\n").trim();
}

/**
 * Build the inline keyboard for the dictionary list view.
 * One button per entry + navigation row + close row.
 */
export function buildDictionaryListKeyboard(
  entries: VocabularyEntryWithTranslations[],
  page: number,
  totalPages: number,
  lang: SupportedLang,
): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard();

  // One button per entry
  for (const entry of entries) {
    const emoji = entry.emoji ?? "";
    const label = emoji
      ? `${emoji} ${truncate(entry.original, MAX_WORD_LENGTH)}`
      : truncate(entry.original, MAX_WORD_LENGTH);
    kb.text(label, `dict:view:${entry.id}`).row();
  }

  // Navigation row (only if > 1 page)
  if (totalPages > 1) {
    if (page > 1) {
      kb.text(t("dictionaryPrev", l), `dict:page:${page - 1}`);
    }
    kb.text(`${page}/${totalPages}`, "dict:noop");
    if (page < totalPages) {
      kb.text(t("dictionaryNext", l), `dict:page:${page + 1}`);
    }
    kb.row();
  }

  // Close row
  kb.text(t("dictionaryClose", l), "dict:close");

  return kb;
}

/**
 * Build the inline keyboard for a single dictionary entry view.
 */
export function buildDictionaryEntryKeyboard(entryId: number, page: number, lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("dictionaryDelete", l), `dict:delete:${entryId}`)
    .row()
    .text(t("dictionaryBack", l), `dict:page:${page}`);
}

/**
 * Build the inline keyboard for delete confirmation.
 */
export function buildDeleteConfirmKeyboard(entryId: number, page: number, lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("dictionaryDeleteYes", l), `dict:confirm-delete:${entryId}:${page}`)
    .row()
    .text(t("dictionaryDeleteCancel", l), `dict:view:${entryId}:${page}`);
}
