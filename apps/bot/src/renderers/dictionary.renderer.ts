/**
 * Dictionary renderer — Telegram-specific rendering for dictionary browse UI.
 *
 * Provides paginated list view, single entry detail view, and inline keyboards.
 * All text via i18n. HTML parse mode.
 */

import type {
  LanguageOrderContext,
  SupportedLang,
  VocabTranslationDetails,
  VocabularyDictionaryWithCount,
  VocabularyEntryWithTranslations,
} from "@polyglot/core";
import { isSupported, orderTranslations, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { renderWordCard } from "./word-card.js";

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
  langResolver: (id: number) => string | undefined,
  order: LanguageOrderContext,
  dictionaryName?: string,
): string {
  const l = toLang(lang);
  const lines: string[] = [];

  lines.push(
    esc(
      dictionaryName
        ? t("dictionaryNamedHeader", l, { name: dictionaryName, count: String(totalWords) })
        : t("dictionaryHeader", l, { count: String(totalWords) }),
    ),
  );
  lines.push("");

  if (entries.length === 0) {
    lines.push(esc(t("emptyDictionary", l)));
    return lines.join("\n");
  }

  const startIndex = (page - 1) * DICTIONARY_PAGE_SIZE;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const idx = startIndex + i + 1;
    const emoji = entry.emoji ?? "";
    const original = truncate(entry.original, MAX_WORD_LENGTH);

    // Show up to 2 translation texts, plus "+N" if more. Ordering before the
    // slice matters: it decides *which* two languages the user sees, so an
    // unordered read made the preview itself non-deterministic.
    const translationTexts = orderTranslations(entry.translations, order, langResolver).map((tr) => tr.text);
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
 *
 * Native language first, then the learning languages in the order the user chose
 * them: row order out of Postgres is plan-dependent and moves after any UPDATE,
 * so the sequence is derived here rather than inherited from the rows.
 */
export function renderDictionaryEntry(
  entry: VocabularyEntryWithTranslations,
  langResolver: (id: number) => string | undefined,
  lang: SupportedLang,
  order: LanguageOrderContext,
): string {
  return renderWordCard(
    {
      original: entry.original,
      emoji: entry.emoji,
      sourceLang: langResolver(entry.sourceLangId),
      nativeMeaning: entry.nativeMeaning,
      sourceUsage: entry.sourceUsage,
      langs: orderTranslations(entry.translations, order, langResolver).map((tr) => {
        const details = tr.details as VocabTranslationDetails | null;
        return {
          code: langResolver(tr.targetLangId),
          text: tr.text,
          synonyms: details?.synonyms,
          examples: details?.examples,
          usageNote: tr.usageNote,
          connotationWarning: tr.connotationWarning,
        };
      }),
      answerLang: order.nativeLang,
      nativeLang: order.nativeLang,
    },
    toLang(lang),
  );
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
  dictionaryId: number,
): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard();

  // One button per entry
  for (const entry of entries) {
    const emoji = entry.emoji ?? "";
    const label = emoji
      ? `${emoji} ${truncate(entry.original, MAX_WORD_LENGTH)}`
      : truncate(entry.original, MAX_WORD_LENGTH);
    kb.text(label, `dict:view:${dictionaryId}:${entry.id}:${page}`).row();
  }

  // Navigation row (only if > 1 page)
  if (totalPages > 1) {
    if (page > 1) {
      kb.text(t("dictionaryPrev", l), `dict:page:${dictionaryId}:${page - 1}`);
    }
    kb.text(`${page}/${totalPages}`, "dict:noop");
    if (page < totalPages) {
      kb.text(t("dictionaryNext", l), `dict:page:${dictionaryId}:${page + 1}`);
    }
    kb.row();
  }

  // Close row
  kb.text(t("dictionarySwitch", l), "dict:list").row();
  kb.text(t("dictionaryClose", l), "dict:close");

  return kb;
}

/**
 * Build the inline keyboard for a single dictionary entry view.
 */
export function buildDictionaryEntryKeyboard(
  entryId: number,
  page: number,
  lang: SupportedLang,
  dictionaryId: number,
  options?: { hasTranslations?: boolean },
): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard();

  // Show "Translate" button if entry has no translations
  if (options && options.hasTranslations === false) {
    kb.text(t("dictionaryTranslate", l), `dict:translate:${dictionaryId}:${entryId}:${page}`).row();
  }

  kb.text(t("dictionaryAddTo", l), `dict:add-menu:${dictionaryId}:${entryId}:${page}`)
    .row()
    .text(t("dictionaryMoveTo", l), `dict:move-menu:${dictionaryId}:${entryId}:${page}`)
    .row()
    .text(t("dictionaryDelete", l), `dict:delete:${dictionaryId}:${entryId}:${page}`)
    .row()
    .text(t("dictionaryBack", l), `dict:page:${dictionaryId}:${page}`);
  return kb;
}

/**
 * Build the inline keyboard for delete confirmation.
 */
export function buildDeleteConfirmKeyboard(
  entryId: number,
  page: number,
  lang: SupportedLang,
  dictionaryId: number,
): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("dictionaryDeleteYes", l), `dict:confirm-delete:${dictionaryId}:${entryId}:${page}`)
    .row()
    .text(t("dictionaryDeleteCancel", l), `dict:view:${dictionaryId}:${entryId}:${page}`);
}

export function renderDictionarySwitcher(dictionaries: VocabularyDictionaryWithCount[], lang: SupportedLang): string {
  const l = toLang(lang);
  const lines = [esc(t("dictionarySwitcherTitle", l)), ""];
  for (const dictionary of dictionaries) {
    const defaultMark = dictionary.isDefault ? ` ${esc(t("dictionaryDefaultMark", l))}` : "";
    lines.push(
      esc(t("dictionarySwitcherItem", l, { name: dictionary.name, count: dictionary.entryCount })) + defaultMark,
    );
  }
  return lines.join("\n");
}

export function buildDictionarySwitcherKeyboard(
  dictionaries: VocabularyDictionaryWithCount[],
  lang: SupportedLang,
): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard();
  for (const dictionary of dictionaries) {
    const label = dictionary.isDefault ? `${dictionary.name} · ${t("dictionaryDefaultMark", l)}` : dictionary.name;
    kb.text(label, `dict:open:${dictionary.id}`).row();
  }
  kb.text(t("dictionaryCreate", l), "dict:create").row();
  const custom = dictionaries.filter((dictionary) => !dictionary.isDefault);
  for (const dictionary of custom) {
    kb.text(`${t("dictionaryRename", l)}: ${truncate(dictionary.name, 18)}`, `dict:rename:${dictionary.id}`).row();
    kb.text(
      `${t("dictionaryDeleteCollection", l)}: ${truncate(dictionary.name, 18)}`,
      `dict:delete-dict:${dictionary.id}`,
    ).row();
  }
  kb.text(t("dictionaryClose", l), "dict:close");
  return kb;
}

export function buildDictionaryNamePromptKeyboard(lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard().text(t("dictionaryDeleteCancel", l), "dict:list");
}

export function buildDictionaryChoiceKeyboard(
  dictionaries: VocabularyDictionaryWithCount[],
  action: "add" | "move",
  fromDictionaryId: number,
  entryId: number,
  page: number,
  lang: SupportedLang,
): InlineKeyboard {
  const l = toLang(lang);
  const kb = new InlineKeyboard();
  for (const dictionary of dictionaries) {
    const prefix = dictionary.isDefault ? `${t("dictionaryDefaultMark", l)} ` : "";
    kb.text(
      `${prefix}${truncate(dictionary.name, 28)}`,
      `dict:${action}:${fromDictionaryId}:${entryId}:${dictionary.id}:${page}`,
    ).row();
  }
  kb.text(t("dictionaryBack", l), `dict:view:${fromDictionaryId}:${entryId}:${page}`);
  return kb;
}

export function buildDictionaryDeleteConfirmKeyboard(dictionaryId: number, lang: SupportedLang): InlineKeyboard {
  const l = toLang(lang);
  return new InlineKeyboard()
    .text(t("dictionaryDeleteYes", l), `dict:confirm-delete-dict:${dictionaryId}`)
    .row()
    .text(t("dictionaryDeleteCancel", l), "dict:list");
}
