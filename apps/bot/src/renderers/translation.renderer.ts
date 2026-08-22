/**
 * Renders AI translation output and topic words for Telegram.
 * Uses HTML parse mode for safe rendering of dynamic content.
 */

import type {
  FeatureKey,
  LanguageOrderContext,
  LanguageTranslation,
  LanguageTranslationEntry,
  SupportedLang,
  TemplateFields,
  TopicWord,
  TranslateOutput,
} from "@polyglot/core";
import { FEATURE_KEYS, getLangFlag, isSupported, orderRecordEntries, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { NOOP_CALLBACK } from "../utils/long-op.js";
import { expandableSection } from "./card-sections.js";

/**
 * Marks a button whose feature the viewer's plan does not include. Deliberately a
 * bare glyph and not a "premium only" label: the card stays uncluttered, the badge
 * reads as an invitation, and the explanation lives in the screen the tap opens.
 */
const PAID_BADGE = " ⭐";

export interface TranslationKeyboardOptions {
  interfaceLang?: string;
  msgId?: number;
  isAlreadySaved?: boolean;
  showGrammarButton?: boolean;
  showGrammarDetailButton?: boolean;
  showEtymologyButton?: boolean;
  sourceOverrideLangs?: string[];
  pronounceLangs?: readonly string[];
  /** Feature keys this viewer does NOT have — their buttons get the ⭐ badge. */
  locked?: ReadonlySet<string>;
}

/** Escape HTML special characters for Telegram */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Header emoji prefix. Optional: sentence translations omit the emoji
 * (includeEmoji: false), so render an escaped "emoji " prefix when present and
 * nothing (no dangling space) when absent.
 */
function emojiPrefix(emoji: string | undefined): string {
  return emoji ? `${esc(emoji)} ` : "";
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

  // Prefer the canonical citation form (e.g. German "die Arbeit") when the model
  // supplied one; the raw input stays in output.original for save/dedup.
  const headword = usage.headword?.trim() ? usage.headword : output.original;
  lines.push(`${emojiPrefix(output.emoji)}${sourceFlag} <b>${esc(headword)}</b>${synonyms}`);

  const nativeTranslation = nativeLang ? output.translations[nativeLang] : undefined;

  // With a native translation the explanation is supplementary prose and folds
  // below the examples; without one it IS the answer, so it stays visible.
  const details: string[] = [];
  if (nativeTranslation && nativeLang) {
    lines.push("");
    const nativeFlag = getLangFlag(nativeLang) ?? "🔤";
    const nativeLabel = `${nativeFlag} ${esc(nativeLang.toUpperCase())}`;
    const showNativeSyns = fields?.synonyms !== false && nativeTranslation.synonyms.length > 0;
    const nativeSyns = showNativeSyns ? ` (${nativeTranslation.synonyms.map((s) => esc(s.text)).join(", ")})` : "";
    lines.push(`${nativeLabel}: <b>${esc(nativeTranslation.text)}</b>${nativeSyns}`);

    if (usage.explanation) {
      details.push(`💡 ${esc(usage.explanation)}`);
    }
  } else if (usage.explanation) {
    lines.push("");
    const nativeFlag = nativeLang ? (getLangFlag(nativeLang) ?? "🔤") : "🔤";
    const label = nativeLang ? `${nativeFlag} ${esc(nativeLang.toUpperCase())}` : nativeFlag;
    lines.push(`${label}: ${esc(usage.explanation)}`);
  }

  if (fields?.examples !== false && usage.examples.length > 0) {
    lines.push("");
    const [first, ...rest] = usage.examples.map(
      (ex) => `💬 <i>${esc(ex.target)}</i>${ex.native ? ` (${esc(ex.native)})` : ""}`,
    );
    lines.push(first!);
    details.unshift(...rest);
  }
  lines.push(...expandableSection(details));

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
  order: LanguageOrderContext,
  interfaceLang?: string,
  templateFields?: TemplateFields,
  nativeLang?: string,
  needsReview?: boolean,
  grammarBreakdown?: Record<string, string[]>,
  etymology?: string,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];
  if (output.correction) {
    lines.push(
      t("correctionNotice", lang, {
        original: esc(output.correction.original),
        corrected: esc(output.correction.corrected),
        explanation: esc(output.correction.explanation),
      }),
    );
    lines.push("");
  }
  if (output.unverified) {
    lines.push(esc(t("translationAsWrittenCaveat", lang)));
    lines.push("");
  }
  const hideSourceText = isReverseLearningTranslation(output, nativeLang);
  const sourceUsageLines = hideSourceText ? renderSourceUsageBlock(output, nativeLang, templateFields) : [];

  const showNativeSyns = !hideSourceText && templateFields?.synonyms !== false && output.nativeSynonyms.length > 0;
  const nativeSyns = showNativeSyns ? ` (${output.nativeSynonyms.map((s) => esc(s.text)).join(", ")})` : "";
  const sourceFlag = getLangFlag(output.sourceLang) ?? "🔤";
  if (sourceUsageLines.length > 0) {
    lines.push(...sourceUsageLines);
  } else if (!hideSourceText) {
    lines.push(`${emojiPrefix(output.emoji)}${sourceFlag} <b>${esc(output.original)}</b>${nativeSyns}`);
  }
  const nativeMeaningLine = renderNativeMeaningLine(nativeLang, output.nativeMeaning);
  const hasNativeTranslation = nativeLang !== undefined && output.translations[nativeLang] !== undefined;
  if (nativeMeaningLine && nativeLang !== output.sourceLang && sourceUsageLines.length === 0 && !hasNativeTranslation) {
    lines.push(nativeMeaningLine);
  }
  lines.push("");

  for (const [code, translation] of orderRecordEntries(output.translations, order)) {
    if (hideSourceText && code === output.sourceLang) continue;
    if (hideSourceText && nativeLang && code === nativeLang && output.sourceUsage) continue;
    lines.push(renderLangBlock(code, translation, lang, templateFields));
    lines.push("");
  }

  // Grammar breakdown section — inline from AI response or cached on-demand
  const gbData = grammarBreakdown ?? collectInlineGrammarBreakdown(output);
  if (gbData && Object.keys(gbData).length > 0 && templateFields?.grammarBreakdown !== false) {
    lines.push(renderGrammarBreakdownSection(gbData, lang, order));
    lines.push("");
  }

  // Etymology section — cached on-demand, rendered next to grammar
  if (etymology) {
    lines.push(renderEtymologySection(etymology, lang));
    lines.push("");
  }

  if (needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Collect inline grammarBreakdown from LanguageTranslation blocks (when included in AI response) */
function collectInlineGrammarBreakdown(output: TranslateOutput): Record<string, string[]> | null {
  const result: Record<string, string[]> = {};
  let hasAny = false;
  for (const [code, translation] of Object.entries(output.translations)) {
    if (translation.grammarBreakdown && translation.grammarBreakdown.length > 0) {
      result[code] = translation.grammarBreakdown;
      hasAny = true;
    }
  }
  return hasAny ? result : null;
}

/** Render grammar breakdown section */
function renderGrammarBreakdownSection(
  breakdown: Record<string, string[]>,
  lang: SupportedLang,
  order: LanguageOrderContext,
): string {
  const lines: string[] = [];
  lines.push(`<b>${esc(t("grammarBreakdown", lang))}</b>`);
  // Ordered entries are derived from `breakdown` itself, so the count driving the
  // per-language header below is unchanged — a breakdown covers only the languages
  // that have one, which is a strict subset of the translated languages.
  const orderedEntries = orderRecordEntries(breakdown, order);
  for (const [code, items] of orderedEntries) {
    if (!items || items.length === 0) continue;
    if (orderedEntries.length > 1) {
      const flag = getLangFlag(code) ?? "🔤";
      lines.push(`${flag} ${esc(code.toUpperCase())}:`);
    }
    for (const item of items) {
      lines.push(`  • ${esc(item)}`);
    }
  }
  return lines.join("\n");
}

/** Render etymology section — concise prose about the original term's origin */
function renderEtymologySection(etymology: string, lang: SupportedLang): string {
  return `<b>${esc(t("etymologySection", lang))}</b>\n${esc(etymology)}`;
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

  // One example stays under the word; the rest fold with the prose. Template
  // gating happens before the fold, so a template that disables everything in
  // it leaves no empty blockquote behind.
  const details: string[] = [];
  if (fields?.examples !== false && lt.examples.length > 0) {
    const [first, ...rest] = lt.examples.map(
      (ex) => `💬 <i>${esc(ex.target)}</i>${ex.native ? ` (${esc(ex.native)})` : ""}`,
    );
    lines.push(first!);
    details.push(...rest);
  }
  if (lt.usageNote) {
    details.push(`💡 ${esc(lt.usageNote)}`);
  }
  if (fields?.connotationWarning !== false && lt.connotationWarning) {
    details.push(t("connotationWarning", lang, { warning: esc(lt.connotationWarning) }));
  }
  lines.push(...expandableSection(details));

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
  order: LanguageOrderContext,
  interfaceLang?: string,
  nativeLang?: string,
  needsReview?: boolean,
  grammarBreakdown?: Record<string, string[]>,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];
  if (output.correction) {
    lines.push(
      t("sentenceErrorNotice", lang, {
        corrected: esc(output.correction.corrected),
        explanation: esc(output.correction.explanation),
      }),
    );
    lines.push("");
  }
  if (output.unverified) {
    lines.push(esc(t("translationAsWrittenCaveat", lang)));
    lines.push("");
  }
  const hideSourceText = isReverseLearningTranslation(output, nativeLang);

  const sourceFlag = getLangFlag(output.sourceLang) ?? "🔤";
  if (!hideSourceText) {
    lines.push(`${emojiPrefix(output.emoji)}${sourceFlag} <b>${esc(output.original)}</b>`);
  }
  const nativeMeaningLine = renderNativeMeaningLine(nativeLang, output.nativeMeaning);
  const hasNativeTranslation = nativeLang !== undefined && output.translations[nativeLang] !== undefined;
  if (nativeMeaningLine && nativeLang !== output.sourceLang && !hasNativeTranslation) {
    lines.push(nativeMeaningLine);
  }
  lines.push("");

  for (const [code, translation] of orderRecordEntries(output.translations, order)) {
    if (hideSourceText && code === output.sourceLang) continue;
    lines.push(renderSentenceLangBlock(code, translation));
    lines.push("");
  }

  if (grammarBreakdown && Object.keys(grammarBreakdown).length > 0) {
    lines.push(renderGrammarBreakdownSection(grammarBreakdown, lang, order));
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
 * Row 1: Clarify meaning + Other meaning
 * Row 2: Grammar + Etymology (learning aids, each shown when enabled — share a row)
 * Row 3: Grammar detail (when expanded)
 * Row 4: Source-language override (only on doubtful-detection cards — a "translate
 *        from" header + one flag button per candidate language, `tr:srclang:*`)
 * Row 5: Pronunciation — one 🔊 button per learning language on the card
 * Row 6: Save button (always last)
 *
 * `sourceOverrideLangs` is populated only when source-language detection was
 * doubtful (a heuristic fallback rather than a confident resolution); it stays
 * empty on the common confident path, so the extra rows are rare by construction.
 *
 * Buttons for features the viewer's plan does not include are still rendered and
 * still carry their normal callback data — they only gain a ⭐ badge, and the
 * handler behind them opens the upgrade screen (Task 79). Keeping the data
 * identical is what makes the badge purely cosmetic: a card sent before an
 * upgrade keeps working, and the server-side gate stays the only authority.
 *
 * Used for all input types (words, phrases, sentences).
 */
export function buildTranslationKeyboard(options: TranslationKeyboardOptions = {}): InlineKeyboard {
  const {
    interfaceLang,
    msgId,
    isAlreadySaved,
    showGrammarButton,
    showGrammarDetailButton,
    showEtymologyButton,
    sourceOverrideLangs,
    pronounceLangs,
    locked,
  } = options;
  const lang = toLang(interfaceLang);
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;
  /** Label + the paid badge when this viewer's plan does not include the feature. */
  const label = (text: string, feature: FeatureKey): string => (locked?.has(feature) ? `${text}${PAID_BADGE}` : text);

  kb.text(label(t("clarifyTranslation", lang), FEATURE_KEYS.clarification), `tr:clarifypost:${mid}`);
  kb.text(label(t("otherMeaning", lang), FEATURE_KEYS.clarification), `tr:altmeaning:${mid}`);

  // Learning aids share a row, next to each other
  if (showGrammarButton || showEtymologyButton) {
    kb.row();
    if (showGrammarButton) {
      kb.text(label(t("grammarBreakdownButton", lang), FEATURE_KEYS.grammarBreakdown), `tr:grammar:${mid}`);
    }
    if (showEtymologyButton) {
      kb.text(label(t("etymology", lang), FEATURE_KEYS.etymology), `tr:etymology:${mid}`);
    }
  }

  if (showGrammarDetailButton) {
    kb.row();
    kb.text(label(t("grammarDetailButton", lang), FEATURE_KEYS.grammarDetail), `tr:gramdetail:${mid}`);
  }

  // Source-language override — only on doubtful cards. A non-actionable header
  // (NOOP) labels the intent, then one flag button per candidate language in
  // rows of up to four. Tapping a flag re-translates the same original with that
  // source forced as an AI hint (handled by `tr:srclang:<code>:<mid>`), sent as a
  // new card so the doubtful card stays as a snapshot.
  if (sourceOverrideLangs && sourceOverrideLangs.length > 0) {
    kb.row();
    kb.text(t("translationSourceFromLabel", lang), NOOP_CALLBACK);
    for (let i = 0; i < sourceOverrideLangs.length; i += 4) {
      kb.row();
      for (const code of sourceOverrideLangs.slice(i, i + 4)) {
        kb.text(`${getLangFlag(code) ?? "🔤"} ${code.toUpperCase()}`, `tr:srclang:${code}:${mid}`);
      }
    }
  }

  // Pronunciation — Telegram has no per-word hit target inside message text, so
  // the speaker for each learning language lives here rather than beside the word.
  // Callers pass only learning languages (see `selectPronounceableLangs`); a single
  // one gets a labelled wide button, several get compact flag buttons so a card
  // with four target languages does not grow four full-width rows.
  if (pronounceLangs && pronounceLangs.length > 0) {
    kb.row();
    if (pronounceLangs.length === 1) {
      const code = pronounceLangs[0]!;
      kb.text(label(t("pronounce", lang), FEATURE_KEYS.pronunciation), `tr:say:${code}:${mid}`);
    } else {
      for (let i = 0; i < pronounceLangs.length; i += 4) {
        if (i > 0) kb.row();
        for (const code of pronounceLangs.slice(i, i + 4)) {
          // Speaker then flag, no language code: the flag alone identifies the
          // language (every supported language has a distinct one), and dropping
          // the code keeps four buttons readable on a narrow screen.
          kb.text(
            label(`🔊 ${getLangFlag(code) ?? code.toUpperCase()}`, FEATURE_KEYS.pronunciation),
            `tr:say:${code}:${mid}`,
          );
        }
      }
    }
  }

  // Save is always the last row
  kb.row();
  if (isAlreadySaved) {
    kb.text(t("alreadySavedButton", lang), `tr:save:${mid}`);
  } else {
    kb.text(t("save", lang), `tr:save:${mid}`);
  }

  return kb;
}

/**
 * Build language selection keyboard for grammar detail.
 * Shows one button per language + cancel.
 */
export function buildGrammarLangKeyboard(
  langCodes: readonly string[],
  interfaceLang?: string,
  msgId?: number,
): InlineKeyboard {
  const lang = toLang(interfaceLang);
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;

  for (const code of langCodes) {
    const flag = getLangFlag(code) ?? "🔤";
    kb.text(`${flag} ${code.toUpperCase()}`, `tr:gramlang:${code}:${mid}`).row();
  }

  kb.text(t("grammarDetailCancel", lang), `tr:gramlang:cancel:${mid}`);

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
