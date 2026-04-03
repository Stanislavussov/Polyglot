/**
 * Translation module types.
 *
 * Matches BRD § 10 AI Response Schema: multi-language translation
 * with emoji, register, synonyms, and contextual examples.
 */

/** Whether a translation is literal or an idiomatic equivalent */
export type ExpressionType = "literal" | "idiomatic_equivalent";

/**
 * Dictionary context from Wiktionary — offline enrichment data.
 *
 * Passed into the translation pipeline by the caller (e.g., bot layer)
 * after looking up word_context from the database.
 * Core never calls the DB directly — this is injected.
 */
export interface DictionaryContext {
  /** Headword without stress marks */
  word: string;
  /** Part of speech: "phrase", "noun", "verb", "adj", "idiom", etc. */
  pos: string;
  /** English definitions/translations from Wiktionary */
  glosses: string[];
  /** Tags for canonical form: "canonical", "romanization", "alternative" */
  formTags?: string[];
  /** ISO 639-1 language code: "ru", "en", "de" */
  langCode: string;
}

/** Word register — formality level of a word or phrase */
export type Register = "slang" | "colloquial" | "neutral" | "literary" | "professional";

/** Example sentence context type */
export type ExampleContext = "neutral" | "colloquial" | "professional";

/** A synonym with its register */
export interface Synonym {
  text: string;
  register: Register;
}

/** An example sentence with context, target language, and register label */
export interface Example {
  context: ExampleContext;
  target: string;
  register: string;
}

/** A single translation variant with its own register and synonyms */
export interface TranslationVariant {
  text: string;
  register: Register;
  synonyms: Synonym[];
}

/** Translation data for a single target language */
export interface LanguageTranslation {
  text: string;
  transcription?: string | null;
  register: Register;
  synonyms: Synonym[];
  examples: Example[];
  /** Signals whether the translation is literal or an idiomatic equivalent */
  expressionType?: ExpressionType | null;
  /** Short note in the source language explaining why an equivalent was chosen */
  equivalentNote?: string | null;
  /** Up to 2 alternative translation variants, each with its own register and synonyms */
  alternatives?: TranslationVariant[] | null;
  /** Optional warning about dangerous or misleading connotations */
  connotationWarning?: string | null;
}

// TranslationOutputConfig lives in shared/ so leaf modules (topics, etc.)
// can use it without creating forbidden cross-module imports.
import type { TranslationOutputConfig } from "../../shared/types.js";

export type { TranslationOutputConfig } from "../../shared/types.js";

/** Detected input type — drives prompt, schema, and validation behavior */
export type InputType = "word" | "phrase" | "sentence";

/** Input for a translation request */
export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];
  topic?: string;
  /** Optional Wiktionary dictionary context for prompt enrichment */
  dictionaryContext?: DictionaryContext;
  /** Optional output config to control which fields are requested from AI */
  outputConfig?: TranslationOutputConfig;
  /** Classified input type — drives prompt, schema, and validation behavior */
  inputType?: InputType;
}

/**
 * Full AI translation result — multi-language.
 * Contains translations for all requested target languages in a single object.
 */
export interface TranslationResult {
  emoji: string;
  register: Register;
  translations: Record<string, LanguageTranslation>;
}

/** Input for the translate() entry point */
export interface TranslateInput {
  word: string;
  sourceLang: string;
  targetLangs: string[];
  model: string;
  topic?: string;
  userId?: number;
  /** Optional Wiktionary dictionary context for translation enrichment */
  dictionaryContext?: DictionaryContext;
  /** Optional output config to control which fields are requested from AI */
  outputConfig?: TranslationOutputConfig;
  /** Classified input type — drives prompt, schema, and validation behavior */
  inputType?: InputType;
}

/** Output from translate() — enriched TranslationResult with metadata */
export interface TranslateOutput {
  original: string;
  sourceLang: string;
  emoji: string;
  register: Register;
  translations: Record<string, LanguageTranslation>;
  needsReview?: boolean;
  /** Dictionary context that was used to enrich this translation (if any) */
  dictionaryContext?: DictionaryContext;
}
