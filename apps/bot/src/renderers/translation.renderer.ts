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

function renderNativeMeaningLine(nativeLang: string | undefined, nativeMeaning: string | undefined): string | null {
  if (!nativeMeaning) return null;
  if (!nativeLang) return esc(nativeMeaning);
  const flag = getLangFlag(nativeLang) ?? "🔤";
  return `${flag} ${esc(nativeLang.toUpperCase())}: ${esc(nativeMeaning)}`;
}

function isReverseLearningTranslation(output: TranslateOutput, nativeLang: string | undefined): boolean {
  return nativeLang !== undefined && output.sourceLang !== nativeLang;
}

function renderSourceUsageBlock(
  output: TranslateOutput,
  nativeLang: string | undefined,
  fields?: TemplateFields,
): string[] {
  const usage = output.sourceUsage;
  if (!usage) return [];

  const lines: string[] = [];
  const sourceFlag = getLangFlag(output.sourceLang) ?? "🔤";
  const showSynonyms = fields?.synonyms !== false && usage.synonyms.length > 0;
  const synonyms = showSynonyms ? ` (${usage.synonyms.map((s) => esc(s.text)).join(", ")})` : "";

  lines.push(`${esc(output.emoji)} ${sourceFlag} <b>${esc(output.original)}</b>${synonyms}`);

  const nativeTranslation = nativeLang ? output.translations[nativeLang] : undefined;

  if (nativeTranslation && nativeLang) {
    lines.push("");
    const nativeFlag = getLangFlag(nativeLang) ?? "🔤";
    const nativeLabel = `${nativeFlag} ${esc(nativeLang.toUpperCase())}`;
    const showNativeSyns = fields?.synonyms !== false && nativeTranslation.synonyms.length > 0;
    const nativeSyns = showNativeSyns ? ` (${nativeTranslation.synonyms.map((s) => esc(s.text)).join(", ")})` : "";
    lines.push(`${nativeLabel}: <b>${esc(nativeTranslation.text)}</b>${nativeSyns}`);

    if (usage.explanation) {
      lines.push(`💡 ${esc(usage.explanation)}`);
    }
  } else if (usage.explanation) {
    lines.push("");
    const nativeFlag = nativeLang ? (getLangFlag(nativeLang) ?? "🔤") : "🔤";
    const label = nativeLang ? `${nativeFlag} ${esc(nativeLang.toUpperCase())}` : nativeFlag;
    lines.push(`${label}: ${esc(usage.explanation)}`);
  }

  if (fields?.examples !== false && usage.examples.length > 0) {
    lines.push("");
    for (const ex of usage.examples) {
      const native = ex.native ? ` (${esc(ex.native)})` : "";
      lines.push(`💬 <i>${esc(ex.target)}</i>${native}`);
    }
  }

  return lines;
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
  needsReview?: boolean,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];
  const hideSourceText = isReverseLearningTranslation(output, nativeLang);
  const sourceUsageLines = hideSourceText ? renderSourceUsageBlock(output, nativeLang, templateFields) : [];

  const showNativeSyns = !hideSourceText && templateFields?.synonyms !== false && output.nativeSynonyms.length > 0;
  const nativeSyns = showNativeSyns ? ` (${output.nativeSynonyms.map((s) => esc(s.text)).join(", ")})` : "";
  const sourceFlag = getLangFlag(output.sourceLang) ?? "🔤";
  if (sourceUsageLines.length > 0) {
    lines.push(...sourceUsageLines);
  } else if (!hideSourceText) {
    lines.push(`${esc(output.emoji)} ${sourceFlag} <b>${esc(output.original)}</b>${nativeSyns}`);
  }
  const nativeMeaningLine = renderNativeMeaningLine(nativeLang, output.nativeMeaning);
  const hasNativeTranslation = nativeLang !== undefined && output.translations[nativeLang] !== undefined;
  if (nativeMeaningLine && nativeLang !== output.sourceLang && sourceUsageLines.length === 0 && !hasNativeTranslation) {
    lines.push(nativeMeaningLine);
  }
  lines.push("");

  for (const [code, translation] of Object.entries(output.translations)) {
    if (hideSourceText && code === output.sourceLang) continue;
    if (hideSourceText && nativeLang && code === nativeLang && output.sourceUsage) continue;
    lines.push(renderLangBlock(code, translation, lang, templateFields));
    lines.push("");
  }

  if (needsReview) {
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

  if (lt.usageNote) {
    lines.push(`💡 ${esc(lt.usageNote)}`);
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
  needsReview?: boolean,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];
  const hideSourceText = isReverseLearningTranslation(output, nativeLang);

  const sourceFlag = getLangFlag(output.sourceLang) ?? "🔤";
  if (!hideSourceText) {
    lines.push(`${esc(output.emoji)} ${sourceFlag} <b>${esc(output.original)}</b>`);
  }
  const nativeMeaningLine = renderNativeMeaningLine(nativeLang, output.nativeMeaning);
  const hasNativeTranslation = nativeLang !== undefined && output.translations[nativeLang] !== undefined;
  if (nativeMeaningLine && nativeLang !== output.sourceLang && !hasNativeTranslation) {
    lines.push(nativeMeaningLine);
  }
  lines.push("");

  for (const [code, translation] of Object.entries(output.translations)) {
    if (hideSourceText && code === output.sourceLang) continue;
    lines.push(renderSentenceLangBlock(code, translation));
    lines.push("");
  }

  if (needsReview) {
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
 * Build unified inline keyboard for translation results.
 *
 * Layout:
 * Row 1: Save button
 * Row 2: Clarify + Other meaning
 *
 * Used for all input types (words, phrases, sentences).
 */
export function buildTranslationKeyboard(
  interfaceLang?: string,
  msgId?: number,
  isAlreadySaved?: boolean,
): InlineKeyboard {
  const lang = toLang(interfaceLang);
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;

  if (isAlreadySaved) {
    kb.text(t("alreadySavedButton", lang), `tr:save:${mid}`);
  } else {
    kb.text(t("save", lang), `tr:save:${mid}`);
  }
  kb.row();

  kb.text(t("clarifyTranslation", lang), `tr:clarifypost:${mid}`);
  kb.text(t("otherMeaning", lang), `tr:altmeaning:${mid}`);

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
