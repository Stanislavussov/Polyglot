/**
 * Renders AI translation output and topic words for Telegram.
 * Uses HTML parse mode for safe rendering of dynamic content.
 */

import type {
  LanguageTranslation,
  LanguageTranslationEntry,
  SupportedLang,
  TemplateFields,
  TopicWord,
  TranslateOutput,
} from "@polyglot/core";
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

function regenButtonLabel(code: string): string {
  const flag = getLangFlag(code) ?? "🔤";
  return `🔄 ${flag}`;
}

function renderNativeMeaningLine(nativeLang: string | undefined, nativeMeaning: string | undefined): string | null {
  if (!nativeMeaning) return null;
  if (!nativeLang) return esc(nativeMeaning);
  const flag = getLangFlag(nativeLang) ?? "🔤";
  return `${flag} ${esc(nativeLang.toUpperCase())}: ${esc(nativeMeaning)}`;
}

function isReverseLearningTranslation(output: TranslateOutput, nativeLang: string | undefined): boolean {
  return nativeLang !== undefined && output.sourceLang !== nativeLang;
}

/**
 * Render a full AI translation card for Telegram (HTML).
 *
 * Shows emoji, original word, and per-language translations
 * with synonyms and contextual examples.
 *
 * @param templateFields - Optional field visibility overrides.
 *   When provided, disabled fields are omitted from the card.
 *   When undefined, ALL sections are rendered (backward compat).
 */
export function renderTranslation(
  output: TranslateOutput,
  interfaceLang?: string,
  templateFields?: TemplateFields,
  nativeLang?: string,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];
  const hideSourceText = isReverseLearningTranslation(output, nativeLang);

  const showNativeSyns = !hideSourceText && templateFields?.synonyms !== false && output.nativeSynonyms.length > 0;
  const nativeSyns = showNativeSyns ? ` (${output.nativeSynonyms.map((s) => esc(s.text)).join(", ")})` : "";
  if (!hideSourceText) {
    lines.push(`${esc(output.emoji)} <b>${esc(output.original)}</b>${esc(nativeSyns)}`);
  }
  const nativeMeaningLine = renderNativeMeaningLine(nativeLang, output.nativeMeaning);
  if (nativeMeaningLine) {
    lines.push(nativeMeaningLine);
  }
  lines.push("");

  for (const [code, translation] of Object.entries(output.translations)) {
    if (hideSourceText && code === output.sourceLang) continue;
    lines.push(renderLangBlock(code, translation, lang, templateFields));
    lines.push("");
  }

  // Dictionary context is NOT rendered to the user — it is only used
  // to enrich the AI prompt via the context-enrichment layer.

  if (output.needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Render a single language translation block */
function renderLangBlock(code: string, lt: LanguageTranslation, lang: SupportedLang, fields?: TemplateFields): string {
  const lines: string[] = [];

  const header = `<b>${esc(lt.text)}</b>`;

  // Inline synonyms: omit when fields?.synonyms === false
  const showSynonyms = fields?.synonyms !== false;
  const synInline =
    showSynonyms && lt.synonyms.length > 0 ? ` (${lt.synonyms.map((s) => esc(s.text)).join(", ")})` : "";

  const flag = getLangFlag(code) ?? "🔤";
  lines.push(`${flag} ${esc(code.toUpperCase())}: ${header}${synInline}`);

  // Alternatives: omit when fields?.alternatives === false
  if (fields?.alternatives !== false && lt.alternatives && lt.alternatives.length > 0) {
    for (const alt of lt.alternatives) {
      const altSyns = alt.synonyms.map((s) => esc(s.text)).join(", ");
      lines.push(`   ∙ ${esc(alt.text)}${altSyns ? ` — ${altSyns}` : ""}`);
    }
  }

  // Examples: omit when fields?.examples === false
  if (fields?.examples !== false && lt.examples.length > 0) {
    for (const ex of lt.examples) {
      const native = ex.native ? ` (${esc(ex.native)})` : "";
      lines.push(`💬 <i>${esc(ex.target)}</i>${native}`);
    }
  }

  // Connotation warning: omit when fields?.connotationWarning === false
  if (fields?.connotationWarning !== false && lt.connotationWarning) {
    lines.push(t("connotationWarning", lang, { warning: esc(lt.connotationWarning) }));
  }

  return lines.join("\n");
}

/**
 * Render a single topic word card for Telegram (HTML).
 *
 * Compact format showing the word and its translations per language.
 */
export function renderTopicWord(word: TopicWord): string {
  const lines: string[] = [];
  lines.push(`<b>${esc(word.original)}</b>`);
  lines.push("");

  for (const [code, entry] of Object.entries(word.translations)) {
    const e = entry as LanguageTranslationEntry;
    const header = `<b>${esc(e.text)}</b>`;
    const flag = getLangFlag(code) ?? "🔤";
    lines.push(`${flag} ${esc(code.toUpperCase())}: ${header}`);
  }

  return lines.join("\n").trim();
}

/**
 * Render a compact sentence translation card for Telegram (HTML).
 *
 * Shows only: emoji, original sentence, and per-language translations.
 * No synonyms, examples, or alternatives.
 */
export function renderSentenceTranslation(
  output: TranslateOutput,
  interfaceLang?: string,
  nativeLang?: string,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];
  const hideSourceText = isReverseLearningTranslation(output, nativeLang);

  if (!hideSourceText) {
    lines.push(`${esc(output.emoji)} <b>${esc(output.original)}</b>`);
  }
  const nativeMeaningLine = renderNativeMeaningLine(nativeLang, output.nativeMeaning);
  if (nativeMeaningLine) {
    lines.push(nativeMeaningLine);
  }
  lines.push("");

  for (const [code, translation] of Object.entries(output.translations)) {
    if (hideSourceText && code === output.sourceLang) continue;
    lines.push(renderSentenceLangBlock(code, translation));
    lines.push("");
  }

  if (output.needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Render a single language block for sentence translation (compact) */
function renderSentenceLangBlock(code: string, lt: LanguageTranslation): string {
  const flag = getLangFlag(code) ?? "🔤";
  const header = `<b>${esc(lt.text)}</b>`;
  return `${flag} ${esc(code.toUpperCase())}: ${header}`;
}

/**
 * Build inline keyboard for sentence translations.
 * Only regenerate buttons — no Save/Skip (sentences aren't saved to dictionary).
 */
export function buildSentenceKeyboard(langCodes: string[], _interfaceLang?: string, msgId?: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;

  for (const code of langCodes) {
    kb.text(regenButtonLabel(code), `tr:regen:${code}:${mid}`);
  }

  return kb;
}

/**
 * Build inline keyboard with per-language regenerate buttons + save/skip.
 * Each regenerate button has callback data "tr:regen:<langCode>:<msgId>".
 * Save/skip buttons include msgId: "tr:save:<msgId>" / "tr:skip:<msgId>".
 */
export function buildTranslationKeyboard(
  langCodes: string[],
  // biome-ignore lint/correctness/noUnusedFunctionParameters: <temp fix>
  inputType: "word" | "phrase" | "sentence",
  interfaceLang?: string,
  msgId?: number,
): InlineKeyboard {
  const lang = toLang(interfaceLang);
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;

  // Row 1: regenerate buttons (one per language)
  for (const code of langCodes) {
    kb.text(regenButtonLabel(code), `tr:regen:${code}:${mid}`);
  }
  kb.row();

  // Row 2: save / skip
  kb.text(t("save", lang), `tr:save:${mid}`);
  kb.text(t("no", lang), `tr:skip:${mid}`);

  return kb;
}

/**
 * Build inline keyboard for post-save state — regen buttons only, no Save/Skip.
 * Used after a word/phrase has been saved to the dictionary.
 */
export function buildPostSaveKeyboard(langCodes: string[], _interfaceLang?: string, msgId?: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;

  for (const code of langCodes) {
    kb.text(regenButtonLabel(code), `tr:regen:${code}:${mid}`);
  }

  return kb;
}

/** Language option for source language selection keyboard */
export interface LangOption {
  code: string;
  name: string; // localized display name
}

/**
 * Build inline keyboard for post-translation source language selection.
 * Shows one button per configured language (native + learning).
 * Currently selected language is prefixed with ✓.
 *
 * Returns null when user has only 2 languages total (auto-detect sufficient).
 *
 * @param langs - All user languages (native + learning) with localized names
 * @param currentSelection - Currently selected source language code, or null
 * @returns InlineKeyboard or null if menu should not be shown
 */
export function buildSourceLangKeyboard(langs: LangOption[], currentSelection: string | null): InlineKeyboard | null {
  // Don't show menu when user has only 2 languages (1 native + 1 learning)
  if (langs.length <= 2) return null;

  const kb = new InlineKeyboard();

  for (const lang of langs) {
    const label = currentSelection === lang.code ? `✓ ${lang.name}` : lang.name;
    kb.text(label, `tr:srclang:${lang.code}`);
  }

  return kb;
}

/**
 * Render a quality uncertain warning line for DB-flagged words.
 *
 * Used for words flagged by the lite AI validator (Task 37)
 * when displaying dictionary entries or flashcards with `needs_review = true`.
 *
 * Distinct from `translationNeedsReview` (used on immediate translate output)
 * — this uses the `qualityUncertain` i18n key for stored/reviewed words.
 *
 * @param interfaceLang - User interface language
 * @returns HTML-safe warning string
 */
export function renderQualityWarning(interfaceLang?: string): string {
  const lang = toLang(interfaceLang);
  return esc(t("qualityUncertain", lang));
}
