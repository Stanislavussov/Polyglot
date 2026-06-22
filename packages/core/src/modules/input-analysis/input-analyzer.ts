/**
 * Input analyzer — classifies user input and detects structural features.
 *
 * Pure, stateless analysis. No imports from sibling core modules.
 * The primary classification is token-count-based (word / phrase / sentence),
 * with feature detection providing metadata for prompt construction, validation,
 * and risk scoring.
 *
 * Feature adjustments to classification:
 * - URL-only input → "sentence" (technical string, not a learnable word)
 * - Input with code-switching → "sentence" (mixed scripts need full pipeline)
 */

import type { InputAnalysis, InputAnalyzerConfig, InputClassification, InputFeatures, InputType } from "./types.js";

export type { InputAnalysis, InputAnalyzerConfig, InputClassification, InputFeatures, InputType } from "./types.js";

const DEFAULT_CONFIG: InputAnalyzerConfig = {
  maxWordTokens: 2,
  maxPhraseTokens: 6,
};

// ─────────────────────────────────────────────
// Feature detection patterns
// ─────────────────────────────────────────────

/** Sentence-ending punctuation characters (Latin + CJK) */
const SENTENCE_PUNCTUATION = /[.!?。？！]$/;

/**
 * Template placeholders:
 * - {name}, {count} — single-brace
 * - {{count}}, {{name}} — double-brace (i18n format)
 * - %s, %d, %1$s — printf-style
 * - ${var}, ${name} — template-literal-style
 */
const PLACEHOLDER_PATTERN = /\{\{?\w+\}?\}|%\d?\$?[sd]|$\{\w+\}/;

/**
 * URL patterns:
 * - http://, https://
 * - www.example.com
 */
const URL_PATTERN = /https?:\/\/|www\.\w+\.\w+/i;

/**
 * Markdown formatting:
 * - **bold**, __bold__
 * - *italic*, _italic_
 * - [link](url)
 * - # heading
 * - `code`, ```block```
 * - > blockquote
 * - 1. ordered list, - unordered list
 */
const MARKDOWN_PATTERN = /\*\*|__|\*[^*\s]|_[^_\s]|\[.+?\]\(|^#{1,6}\s|```|`[^`]+`|^>\s|^[-*]\s|^\d+\.\s/m;

/**
 * Date and time references:
 * - Numeric dates: 06/07, 2024-01-15, 1/15/2024
 * - Named months: Jan 5, January 5, 5 January
 * - Times: at 5pm, 17:00, 3:30
 * - Relative: tomorrow, yesterday, next week
 */
const DATE_PATTERN =
  /\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?|\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b|\b\d{1,2}:\d{2}\b|\b(tomorrow|yesterday|next\s+week)\b/i;

// ─────────────────────────────────────────────
// Code-switching detection (mixed writing systems)
// ─────────────────────────────────────────────

type ScriptId = "cyrillic" | "latin" | "cjk" | "arabic" | "devanagari" | "greek" | "hangul" | "kana";

function classifyCodePoint(cp: number): ScriptId | undefined {
  if ((cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0500 && cp <= 0x052f)) return "cyrillic";
  if (
    (cp >= 0x0041 && cp <= 0x024f) ||
    (cp >= 0x1e00 && cp <= 0x1eff) ||
    (cp >= 0x0100 && cp <= 0x017f) ||
    (cp >= 0x0180 && cp <= 0x024f)
  )
    return "latin";
  if (cp >= 0x4e00 && cp <= 0x9fff) return "cjk";
  if (cp >= 0x0600 && cp <= 0x06ff) return "arabic";
  if (cp >= 0x0900 && cp <= 0x097f) return "devanagari";
  if (cp >= 0x0370 && cp <= 0x03ff) return "greek";
  if (cp >= 0xac00 && cp <= 0xd7af) return "hangul";
  if ((cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff)) return "kana";
  return undefined;
}

function detectCodeSwitching(text: string): boolean {
  const scripts = new Set<ScriptId>();
  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    const script = classifyCodePoint(cp);
    if (script) scripts.add(script);
  }
  // Code-switching = 2+ different writing systems present
  return scripts.size >= 2;
}

// ─────────────────────────────────────────────
// Main analysis function
// ─────────────────────────────────────────────

/**
 * Analyze user input — classify type and detect structural features.
 *
 * Classification rules (primary):
 * 1. Trim input, split by whitespace → wordCount
 * 2. wordCount <= maxWordTokens → 'word'
 * 3. wordCount <= maxPhraseTokens → 'phrase'
 * 4. wordCount > maxPhraseTokens → 'sentence'
 *
 * Feature-based overrides:
 * - URL-only input → 'sentence' regardless of word count
 * - Code-switching (mixed scripts) → 'sentence' regardless of word count
 *
 * @param text - Raw user input
 * @param config - Optional threshold overrides
 * @returns InputAnalysis with classified type and detected features
 */
export function analyzeInput(text: string, config?: Partial<InputAnalyzerConfig>): InputAnalysis {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const trimmed = text.trim();
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const wordCount = tokens.length;

  const features: InputFeatures = {
    wordCount,
    hasSentencePunctuation: SENTENCE_PUNCTUATION.test(trimmed),
    hasPlaceholders: PLACEHOLDER_PATTERN.test(trimmed),
    hasUrl: URL_PATTERN.test(trimmed),
    hasMarkdown: MARKDOWN_PATTERN.test(trimmed),
    hasDates: DATE_PATTERN.test(trimmed),
    hasCodeSwitching: detectCodeSwitching(trimmed),
  };

  // Primary classification by token count
  let type: InputType;
  if (wordCount <= cfg.maxWordTokens) {
    type = "word";
  } else if (wordCount <= cfg.maxPhraseTokens) {
    type = "phrase";
  } else {
    type = "sentence";
  }

  // Feature-based overrides: URL-only or code-switching → sentence
  if (features.hasUrl && wordCount <= cfg.maxWordTokens) {
    type = "sentence";
  }
  if (features.hasCodeSwitching && wordCount <= cfg.maxPhraseTokens) {
    type = "sentence";
  }

  return { type, features };
}

/**
 * Backward-compatible classifyInput — returns only type and basic metadata.
 *
 * Equivalent to `analyzeInput(text, config)` but returns the legacy
 * `{ type, wordCount, hasSentencePunctuation }` shape.
 */
export function classifyInput(text: string, config?: Partial<InputAnalyzerConfig>): InputClassification {
  const analysis = analyzeInput(text, config);
  return {
    type: analysis.type,
    wordCount: analysis.features.wordCount,
    hasSentencePunctuation: analysis.features.hasSentencePunctuation,
  };
}
