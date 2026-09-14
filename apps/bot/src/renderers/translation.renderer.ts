/**
 * Renders AI translation output and topic words for Telegram.
 * Uses HTML parse mode for safe rendering of dynamic content.
 *
 * Every line of card text comes from `card-sections.ts` — the headword, each
 * answer, each example, each note. This module used to build them inline, which
 * is how the live card and the stored-word card drifted apart: a fix to the
 * shared grammar reached `renderWordCard` and stopped here. Build a card line by
 * hand below and that gap reopens; add the atom to `card-sections.ts` instead.
 * Keyboard labels are not card text, and are the one place `getLangFlag` is still
 * read directly — a button has room for the flag alone.
 */

import type {
  FeatureKey,
  I18nKey,
  InputType,
  LanguageOrderContext,
  LanguageTranslation,
  SupportedLang,
  TemplateFields,
  TranslateOutput,
  VocabDifficulty,
} from "@polyglot/core";
import { FEATURE_KEYS, getLangFlag, isSupported, orderRecordEntries, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { NOOP_CALLBACK } from "../utils/long-op.js";
import { answerLine, esc, exampleLine, expandableSection, headwordLine, meaningLine } from "./card-sections.js";
import { appendGradeRow, notifGradeCallback } from "./grade-row.js";

const EXPLORE_LABEL: Record<InputType, I18nKey> = {
  word: "cardExploreWord",
  phrase: "cardExplorePhrase",
  sentence: "cardExploreSentence",
};

export interface TranslationKeyboardOptions {
  interfaceLang?: string;
  msgId?: number;
  isAlreadySaved?: boolean;
  /** Show the action list rather than the `🔍 Explore this word` button that opens it. */
  expanded?: boolean;
  /** What was translated — names it on the button that opens the action list; a word when absent. */
  inputType?: InputType;
  showEtymologyButton?: boolean;
  showMentorButton?: boolean;
  sourceOverrideLangs?: readonly string[];
  pronounceLangs?: readonly string[];
  /**
   * Feature keys this viewer does NOT have, each mapped to the badge its button
   * wears — the glyph of the tier that sells it (⭐ Plus, 💎 Pro), from
   * `resolveLockedBadges`. Deliberately a bare glyph and not a "premium only"
   * label: the card stays uncluttered and the explanation lives in the screen the
   * tap opens — a screen that then offers exactly the tier the glyph named.
   */
  locked?: ReadonlyMap<string, string>;
  /** Recall grades for a card opened from a notification nudge — the entry they grade and the grade on file. */
  grades?: { entryId: number; selected?: VocabDifficulty | null };
}

/** Resolve a string to SupportedLang with "en" fallback */
function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

/**
 * The stored gloss, as a note.
 *
 * Never an answer line: the gloss is a sentence *about* the word ("Богомол;
 * название насекомого."), and wearing `🇷🇺 RU:` made a paragraph of description
 * read as the translation the reader was hunting for. `renderWordCard` has
 * treated it this way since the same defect was fixed there.
 */
function renderNativeMeaningLine(nativeMeaning: string | undefined): string | null {
  return nativeMeaning ? meaningLine(nativeMeaning) : null;
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
  const showSynonyms = fields?.synonyms !== false && usage.synonyms.length > 0;
  const synonyms = showSynonyms ? usage.synonyms.map((s) => s.text) : [];

  // Prefer the canonical citation form (e.g. German "die Arbeit") when the model
  // supplied one; the raw input stays in output.original for save/dedup.
  const headword = usage.headword?.trim() ? usage.headword : output.original;
  lines.push(headwordLine(headword, { emoji: output.emoji, sourceLang: output.sourceLang, synonyms }));

  const nativeTranslation = nativeLang ? output.translations[nativeLang] : undefined;

  // With a native translation the explanation is supplementary prose and folds
  // below the examples; without one it IS the answer, so it stays visible — but a
  // note either way, never a labelled answer line: it is a description of the
  // word, and dressing it as the missing translation is the defect this card was
  // already fixed for once.
  const details: string[] = [];
  if (nativeTranslation && nativeLang) {
    lines.push("");
    const showNativeSyns = fields?.synonyms !== false && nativeTranslation.synonyms.length > 0;
    const nativeSyns = showNativeSyns ? nativeTranslation.synonyms.map((s) => s.text) : [];
    lines.push(answerLine(nativeLang, nativeTranslation.text, nativeSyns));

    if (usage.explanation) {
      details.push(meaningLine(usage.explanation));
    }
  } else if (usage.explanation) {
    lines.push("");
    lines.push(meaningLine(usage.explanation));
  }

  if (fields?.examples !== false && usage.examples.length > 0) {
    lines.push("");
    const [first, ...rest] = usage.examples.map((ex) => exampleLine(ex.target, ex.native));
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
  const nativeSyns = showNativeSyns ? output.nativeSynonyms.map((s) => s.text) : [];
  if (sourceUsageLines.length > 0) {
    lines.push(...sourceUsageLines);
  } else {
    // Reverse direction without a sourceUsage block (the model may omit it) still
    // needs the headword: dropping it left the user with translations of a word
    // the card never named.
    lines.push(
      headwordLine(output.original, { emoji: output.emoji, sourceLang: output.sourceLang, synonyms: nativeSyns }),
    );
  }
  const nativeMeaningLine = renderNativeMeaningLine(output.nativeMeaning);
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

  // Etymology section — cached on-demand
  if (etymology) {
    lines.push(renderEtymologySection(etymology, lang));
    lines.push("");
  }

  if (needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Render etymology section — concise prose about the original term's origin */
function renderEtymologySection(etymology: string, lang: SupportedLang): string {
  return `<b>${esc(t("etymologySection", lang))}</b>\n${esc(etymology)}`;
}

/** Render a single language translation block */
function renderLangBlock(code: string, lt: LanguageTranslation, lang: SupportedLang, fields?: TemplateFields): string {
  const lines: string[] = [];

  // Inline synonyms: omit when fields?.synonyms === false
  const showSynonyms = fields?.synonyms !== false;
  const synInline = showSynonyms ? lt.synonyms.map((s) => s.text) : [];

  lines.push(answerLine(code, lt.text, synInline));

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
    const [first, ...rest] = lt.examples.map((ex) => exampleLine(ex.target, ex.native));
    lines.push(first!);
    details.push(...rest);
  }
  if (lt.usageNote) {
    details.push(meaningLine(lt.usageNote));
  }
  if (fields?.connotationWarning !== false && lt.connotationWarning) {
    details.push(t("connotationWarning", lang, { warning: esc(lt.connotationWarning) }));
  }
  lines.push(...expandableSection(details));

  return lines.join("\n");
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

  // Always shown, in both directions: a sentence has no sourceUsage block to carry
  // the original the way a word card does, so hiding it left an unanchored card.
  lines.push(headwordLine(output.original, { emoji: output.emoji, sourceLang: output.sourceLang }));
  const nativeMeaningLine = renderNativeMeaningLine(output.nativeMeaning);
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

  if (needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Render a single language block for sentence translation (compact) */
function renderSentenceLangBlock(code: string, lt: LanguageTranslation): string {
  return answerLine(code, lt.text);
}

/** One inline button, before it is placed into a row. */
type CardButton = { text: string; data: string };

/**
 * How many actions share a row in the expanded list.
 *
 * Two, not one: the list runs to six actions on a rich card, and a column of
 * six full-width buttons is taller than the card it belongs to — the user
 * scrolls past the translation to reach them. Two per row halves that without
 * making any label unreadable, since every one of them is a short noun phrase.
 */
const ACTIONS_PER_ROW = 2;

/** Compact flag buttons (two glyphs) fit four across even on a narrow screen. */
const FLAGS_PER_ROW = 4;

/**
 * Lay `buttons` out `perRow` to a row, continuing the keyboard where it stands.
 *
 * The row break is taken BEFORE each chunk and only when the current row has
 * something in it — a break taken after would leave a trailing empty row, which
 * Telegram renders as a gap and which makes "Save is the last row" quietly false.
 */
function appendInRows(kb: InlineKeyboard, buttons: readonly CardButton[], perRow: number): void {
  for (let i = 0; i < buttons.length; i += perRow) {
    if (kb.inline_keyboard.at(-1)?.length) kb.row();
    for (const button of buttons.slice(i, i + perRow)) {
      kb.text(button.text, button.data);
    }
  }
}

/**
 * Build the inline keyboard for a translation card, in one of its two states.
 *
 * **Collapsed** (the default, what a fresh card wears):
 * ```
 * 🔊 🇩🇪  🔊 🇨🇿
 * 🔍 Explore this word      (phrase / sentence, per `inputType`)
 * 💾 Save
 * ```
 * **Expanded** (after `🔍 Explore`) — the actions two to a row, then the
 * source-language override, then the same speakers, then the way back:
 * ```
 * 🎯 Clarify meaning  🔄 Other meaning
 * 🧑‍🏫 Ask the mentor   🔍 Etymology
 * 🌐 Wrong language? Translate from:
 * 🇩🇪 DE  🇫🇷 FR
 * 🔊 🇩🇪  🔊 🇨🇿
 * ← Back
 * ```
 *
 * The learning aids hide behind one button because the flat layout grew past what
 * a card should carry: clarify, other meaning, the mentor and etymology all
 * competed with the translation itself. The toggle is pure presentation —
 * `tr:more`/`tr:less` only swap the markup, so neither state costs a call or
 * changes the card's text.
 *
 * The speakers stay OUT of the fold, in the same place in both states: hearing the
 * word is the one thing a learner does without deciding to, so it must not cost a
 * tap to reach, and a control that moves when a menu opens is a control you have
 * to look for.
 *
 * Save belongs to the card, not to the menu, so it appears only on the collapsed
 * keyboard — full width, on a row of its own. It is the one button here that
 * writes anything, and an open menu is a list of things to *read* about the word;
 * a Save sitting at the end of it is a mis-tap that files a word nobody asked to
 * keep. `← Back` is how the menu is left, and the card underneath it still has
 * Save exactly where it was.
 *
 * `sourceOverrideLangs` is populated only when source-language detection was
 * doubtful (a heuristic fallback rather than a confident resolution); it stays
 * empty on the common confident path, so the extra rows are rare by construction.
 *
 * Buttons for features the viewer's plan does not include are still rendered and
 * still carry their normal callback data — they only gain a plan badge, and the
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
    expanded,
    showEtymologyButton,
    showMentorButton,
    sourceOverrideLangs,
    pronounceLangs,
    locked,
    grades,
    inputType,
  } = options;
  const lang = toLang(interfaceLang);
  const kb = new InlineKeyboard();
  const mid = msgId ?? 0;
  // First row in both states: the grade answers the question the nudge asked, and
  // opening the action list must not move it out from under the reader's thumb.
  if (grades) {
    appendGradeRow(kb, lang, (grade) => notifGradeCallback(grade, grades.entryId), grades.selected);
  }
  /** Label + the badge of the plan that sells it, when this viewer's plan does not. */
  const label = (text: string, feature: FeatureKey): string => {
    const badge = locked?.get(feature);
    return badge ? `${text} ${badge}` : text;
  };
  /**
   * Pronunciation — Telegram has no per-word hit target inside message text, so
   * the speaker for each non-native word lives on the keyboard rather than beside
   * the word. Callers pass every language the card shows but the native one (see
   * `selectPronounceableLangs`); one gets a labelled wide button, several become
   * compact flags — speaker then flag, no language code, since the flag alone
   * identifies the language and dropping the code keeps four readable on a narrow
   * screen.
   */
  const appendSpeakers = (): void => {
    if (!pronounceLangs || pronounceLangs.length === 0) return;
    if (pronounceLangs.length === 1) {
      const code = pronounceLangs[0]!;
      appendInRows(
        kb,
        [{ text: label(t("pronounce", lang), FEATURE_KEYS.pronunciation), data: `tr:say:${code}:${mid}` }],
        1,
      );
      return;
    }
    const speakers = pronounceLangs.map((code) => ({
      text: label(`🔊 ${getLangFlag(code) ?? code.toUpperCase()}`, FEATURE_KEYS.pronunciation),
      data: `tr:say:${code}:${mid}`,
    }));
    appendInRows(kb, speakers, FLAGS_PER_ROW);
  };

  if (!expanded) {
    appendSpeakers();
    appendInRows(
      kb,
      [
        { text: t(EXPLORE_LABEL[inputType ?? "word"], lang), data: `tr:more:${mid}` },
        {
          text: isAlreadySaved ? t("alreadySavedButton", lang) : t("save", lang),
          data: `tr:save:${mid}`,
        },
      ],
      1,
    );
    return kb;
  }

  const actions: CardButton[] = [];
  actions.push({
    text: label(t("clarifyTranslation", lang), FEATURE_KEYS.clarification),
    data: `tr:clarifypost:${mid}`,
  });
  actions.push({ text: label(t("otherMeaning", lang), FEATURE_KEYS.clarification), data: `tr:altmeaning:${mid}` });
  if (showMentorButton) {
    actions.push({ text: label(t("cardAskMentor", lang), FEATURE_KEYS.mentor), data: `tr:mentor:${mid}` });
  }
  if (showEtymologyButton) {
    actions.push({ text: label(t("etymology", lang), FEATURE_KEYS.etymology), data: `tr:etymology:${mid}` });
  }
  appendInRows(kb, actions, ACTIONS_PER_ROW);

  // Source-language override — only on doubtful cards. A non-actionable header
  // (NOOP) labels the intent, then one flag button per candidate language.
  // Tapping a flag re-translates the same original with that source forced as an
  // AI hint (handled by `tr:srclang:<code>:<mid>`), sent as a new card so the
  // doubtful card stays as a snapshot. The header keeps a row of its own: it is a
  // caption for the flags under it, not a button to pair with one.
  if (sourceOverrideLangs && sourceOverrideLangs.length > 0) {
    appendInRows(kb, [{ text: t("translationSourceFromLabel", lang), data: NOOP_CALLBACK }], 1);
    const flags = sourceOverrideLangs.map((code) => ({
      text: `${getLangFlag(code) ?? "🔤"} ${code.toUpperCase()}`,
      data: `tr:srclang:${code}:${mid}`,
    }));
    appendInRows(kb, flags, FLAGS_PER_ROW);
  }

  appendSpeakers();
  appendInRows(kb, [{ text: t("cardBack", lang), data: `tr:less:${mid}` }], 1);

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
