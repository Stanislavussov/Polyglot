/**
 * Input classifier — determines whether user input is a word, phrase, or sentence.
 *
 * Pure, stateless classification based on word count.
 * Punctuation is metadata only — NOT a hard classifier.
 * Short questions like "How are you?" remain 'phrase' because
 * they are valid learnable dictionary entries.
 *
 * NOTE: This is a local utility. When the core input-classifier module
 * is created in packages/core, this should be replaced with an import
 * from @polyglot/core.
 */

import type { InputType } from "@polyglot/core";

/** Classification result with diagnostic metadata */
export interface InputClassification {
  type: InputType;
  /** Number of whitespace-separated tokens */
  wordCount: number;
  /** Whether sentence-ending punctuation was detected */
  hasSentencePunctuation: boolean;
}

/** Configurable thresholds */
export interface InputClassifierConfig {
  /** Max tokens for "word" classification (default: 2) */
  maxWordTokens: number;
  /** Max tokens for "phrase" classification (default: 6) */
  maxPhraseTokens: number;
}

const DEFAULT_CONFIG: InputClassifierConfig = {
  maxWordTokens: 2,
  maxPhraseTokens: 6,
};

/** Sentence-ending punctuation characters (Latin + CJK) */
const SENTENCE_PUNCTUATION = /[.!?。？！]$/;

/**
 * Classify user input as word, phrase, or sentence.
 *
 * Rules:
 * 1. Trim input, split by whitespace → wordCount
 * 2. Detect sentence-ending punctuation → hasSentencePunctuation (metadata only)
 * 3. wordCount <= maxWordTokens → 'word'
 * 4. wordCount <= maxPhraseTokens → 'phrase'
 * 5. wordCount > maxPhraseTokens → 'sentence'
 */
export function classifyInput(text: string, config?: Partial<InputClassifierConfig>): InputClassification {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const trimmed = text.trim();
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const wordCount = tokens.length;
  const hasSentencePunctuation = SENTENCE_PUNCTUATION.test(trimmed);

  let type: InputType;
  if (wordCount <= cfg.maxWordTokens) {
    type = "word";
  } else if (wordCount <= cfg.maxPhraseTokens) {
    type = "phrase";
  } else {
    type = "sentence";
  }

  return { type, wordCount, hasSentencePunctuation };
}
