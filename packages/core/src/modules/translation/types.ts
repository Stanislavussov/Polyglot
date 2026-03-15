/**
 * Translation module types.
 *
 * Matches BRD § 10 AI Response Schema: multi-language translation
 * with emoji, CEFR level, register, synonyms, and contextual examples.
 */

/** Word register — formality level of a word or phrase */
export type Register =
  | "slang"
  | "colloquial"
  | "neutral"
  | "literary"
  | "professional";

/** CEFR language proficiency level */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** Example sentence context type */
export type ExampleContext = "formal" | "colloquial" | "professional";

/** A synonym with its register */
export interface Synonym {
  text: string;
  register: Register;
}

/** An example sentence with context, target language, and native translation */
export interface Example {
  context: ExampleContext;
  target: string;
  native: string;
}

/** Translation data for a single target language */
export interface LanguageTranslation {
  text: string;
  cefr: CefrLevel;
  transcription?: string;
  register: Register;
  synonyms: Synonym[];
  examples: Example[];
}

/** Input for a translation request */
export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLangs: string[];
  topic?: string;
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
}

/** Output from translate() — enriched TranslationResult with metadata */
export interface TranslateOutput {
  original: string;
  sourceLang: string;
  emoji: string;
  register: Register;
  translations: Record<string, LanguageTranslation>;
  needsReview?: boolean;
}
