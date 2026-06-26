/**
 * Input analysis types.
 *
 * This module is a leaf — it must not import from any sibling core module.
 * It owns the `InputType` definition that other modules (translation, etc.) re-export.
 */

/** Detected input type — drives prompt, schema, and validation behavior */
export type InputType = "word" | "phrase" | "sentence";

/** Configurable thresholds for token-count-based classification */
export interface InputAnalyzerConfig {
  /** Max tokens for "word" classification (default: 2) */
  maxWordTokens: number;
  /** Max tokens for "phrase" classification (default: 6) */
  maxPhraseTokens: number;
}

/**
 * Structural features detected in user input.
 *
 * These are metadata that inform prompt construction, validation, and
 * risk scoring — they do not override the primary token-count classification
 * except for clear cases like URL-only input.
 */
export interface InputFeatures {
  /** Number of whitespace-separated tokens */
  wordCount: number;
  /** Whether sentence-ending punctuation was detected ([.!?。？！]$) */
  hasSentencePunctuation: boolean;
  /** Whether template placeholders are present ({name}, {{count}}, %s, ${var}) */
  hasPlaceholders: boolean;
  /** Whether a URL is present (http://, https://, www.example.com) */
  hasUrl: boolean;
  /** Whether Markdown formatting is present (**bold**, *italic*, [link](), # heading) */
  hasMarkdown: boolean;
  /** Whether a date or time reference is present (06/07, 2024-01-15, Jan 5, at 5pm) */
  hasDates: boolean;
  /** Whether the text mixes multiple writing systems (e.g. Cyrillic + Latin) */
  hasCodeSwitching: boolean;
}

/**
 * Full input analysis result — classified type plus detected features.
 */
export interface InputAnalysis {
  type: InputType;
  features: InputFeatures;
}

/**
 * Backward-compatible classification result (subset of InputAnalysis).
 *
 * Used by callers that only need the type and basic metadata.
 */
export interface InputClassification {
  type: InputType;
  wordCount: number;
  hasSentencePunctuation: boolean;
}
