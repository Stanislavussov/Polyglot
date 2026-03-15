/** Source and target languages for a translation request */
export interface TranslationRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  topic?: string;
}

/** Result returned by the translation service */
export interface TranslationResult {
  original: string;
  translated: string;
  sourceLang: string;
  targetLang: string;
  alternatives?: string[];
}
