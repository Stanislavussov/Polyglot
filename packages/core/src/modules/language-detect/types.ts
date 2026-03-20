/** Input for resolveTranslationDirection() */
export interface ResolveDirectionInput {
  /** The text the user typed */
  text: string;
  /** User's native language (ISO 639-1) */
  nativeLang: string;
  /** User's learning languages (ISO 639-1) */
  learningLangs: string[];
}

/** Resolved translation direction based on detected input language */
export interface TranslationDirection {
  /** Source language for translation (ISO 639-1) */
  sourceLang: string;
  /** Target languages for translation (ISO 639-1) */
  targetLangs: string[];
  /** Detected input language (ISO 639-1), or undefined if inconclusive */
  detectedLang: string | undefined;
}
