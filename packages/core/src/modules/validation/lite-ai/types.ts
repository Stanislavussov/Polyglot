/**
 * Lite AI Validation — Types
 *
 * Structured scoring types for the lightweight AI second-pass validator.
 * The validator evaluates translations on meaning preservation, naturalness,
 * register accuracy, and CEFR accuracy.
 *
 * Pure types — no runtime, no I/O.
 */

import type { DictionaryContext, ExpressionType, LanguageTranslation } from "../../translation/types.js";

/** Quality score for a single target language translation (0–5 scale) */
export interface LiteValidationScore {
  /** How well the translation preserves the original meaning (0–5) */
  meaningPreserved: number;
  /** How natural the translation sounds to a native speaker (0–5) */
  naturalness: number;
  /** How accurate the register/formality level is (0–5) */
  registerAccuracy: number;
  /** How accurate the assigned CEFR level is (0–5) */
  cefrAccuracy: number;
  /** Overall quality score (0–5) */
  overallScore: number;
  /** Brief explanation of the scoring */
  reasoning: string;
}

/** Result of lite AI validation across all target languages */
export interface LiteValidationResult {
  /** Scores keyed by language code (e.g. { cs: {...}, de: {...} }) */
  scores: Record<string, LiteValidationScore>;
  /** True when any language's overallScore is below the review threshold */
  flaggedForReview: boolean;
}

/** Input for the lite validation prompt builder */
export interface LiteValidationInput {
  /** Original word/phrase that was translated */
  original: string;
  /** Source language code (ISO 639-1) */
  sourceLang: string;
  /** Translations keyed by target language code */
  translations: Record<string, LanguageTranslation>;
  /** Optional Wiktionary dictionary context for reference */
  dictionaryContext?: DictionaryContext;
}

/** Input for the risk detector heuristic */
export interface RiskDetectorInput {
  /** Classified input type: word, phrase, or sentence */
  inputType?: "word" | "phrase" | "sentence";
  /** Dictionary context from Wiktionary (undefined = Wiktionary miss) */
  dictionaryContext?: DictionaryContext;
  /** Expression types per language from translation result */
  expressionTypes?: ExpressionType[];
  /** Target language codes (ISO 639-1) */
  targetLangs: string[];
}

/** Parameters for fire-and-forget async validation */
export interface AsyncValidationParams {
  /** The full translate output */
  original: string;
  /** Source language code */
  sourceLang: string;
  /** Translations keyed by target language */
  translations: Record<string, LanguageTranslation>;
  /** Classified input type */
  inputType?: "word" | "phrase" | "sentence";
  /** Dictionary context (if available) */
  dictionaryContext?: DictionaryContext;
  /** Expression types from result */
  expressionTypes?: ExpressionType[];
  /** Target language codes */
  targetLangs: string[];
  /** Validator model ID (undefined = feature disabled) */
  validatorModel?: string;
  /** AI generation function */
  generateObjectFn: <T>(
    prompt: string,
    schema: import("zod").ZodSchema<T>,
    model: string,
    options?: { maxRetries?: number },
  ) => Promise<T>;
  /** Callback when translation is flagged for review */
  onFlagged: (scores: Record<string, LiteValidationScore>) => void;
}
