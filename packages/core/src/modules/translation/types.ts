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

/** A synonym */
export interface Synonym {
  text: string;
}

/** An example sentence with context, target language, and optional native translation */
export interface Example {
  context: string;
  target: string;
  native?: string | null;
}

/** A single translation variant */
export interface TranslationVariant {
  text: string;
  synonyms: Synonym[];
}

/** Translation data for a single target language */
export interface LanguageTranslation {
  text: string;
  synonyms: Synonym[];
  examples: Example[];
  /** Signals whether the translation is literal or an idiomatic equivalent */
  expressionType?: ExpressionType | null;
  /** Short note in the source language explaining why an equivalent was chosen */
  equivalentNote?: string | null;
  /** Up to 2 alternative translation variants */
  alternatives?: TranslationVariant[] | null;
  /** Optional target-side note about noteworthy connotation, register, or usage risk */
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
  /** User's native language — for native synonym generation */
  nativeLang?: string;
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
  nativeMeaning?: string | null;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
}

/** Input for the translate() entry point */
export interface TranslateInput {
  word: string;
  sourceLang: string;
  targetLangs: string[];
  /** User's native language — for native synonym generation */
  nativeLang?: string;
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
  nativeMeaning?: string;
  nativeSynonyms: Synonym[];
  translations: Record<string, LanguageTranslation>;
  needsReview?: boolean;
  dictionaryContext?: DictionaryContext;
}
