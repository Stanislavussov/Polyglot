/**
 * Strict union of all i18n keys — derived from en.json (source of truth).
 * TypeScript won't allow passing a non-existent key to t().
 */
export type I18nKey =
  | "welcome"
  | "choose_language"
  | "translate"
  | "dictionary"
  | "topics"
  | "settings"
  | "back"
  | "cancel"
  | "done"
  | "yes"
  | "no"
  | "chooseNativeLang"
  | "chooseLearningLangs"
  | "enterWord"
  | "demoResult"
  | "onboardingComplete"
  | "welcomeBack"
  | "maxLangsReached"
  | "selectAtLeastOne"
  | "langAdded"
  | "langRemoved"
  | "enterWordToTranslate"
  | "translating"
  | "translationError"
  | "translationUnavailable"
  | "translationNeedsReview"
  | "saveToDict"
  | "savedToDict"
  | "alreadySaved"
  | "wordDeleted"
  | "emptyDictionary"
  | "noResults"
  | "settingsUpdated"
  | "notificationTimeSet"
  | "flipCard"
  | "nextTranslation"
  | "editTranslation"
  | "saveToDictionary"
  | "cefr"
  | "register"
  | "synonyms"
  | "examples"
  | "regenerateLang"
  | "regenerating"
  | "regenerated"
  | "translateModeOn"
  | "translateModeHint"
  | "wiktionaryDefinition"
  | "wiktionarySource"
  | "partOfSpeech"
  | "expressionDetected"
  | "dictionaryContext"
  | "detectedLang"
  | "nextTranslationFrom"
  | "nextSourceSet"
  | "sentenceTranslation"
  | "save"
  | "connotationWarning"
  | "templateTitle"
  | "templateCurrent"
  | "templateDefault"
  | "templateCustom"
  | "templateCustomize"
  | "templateReset"
  | "templateConstructor"
  | "templatePreview"
  | "templateSave"
  | "templateCancel"
  | "templateBack"
  | "templateSaved"
  | "templateResetDone"
  | "templateCancelled"
  | "templateFieldTranscription"
  | "templateFieldSynonyms"
  | "templateFieldExamples"
  | "templateFieldAlternatives"
  | "templateFieldEquivalentNote"
  | "templateFieldConnotationWarning"
  | "templatePreviewHeader"
  | "templateSessionExpired"
  | "cmdDescStart"
  | "cmdDescTranslate"
  | "cmdDescDictionary"
  | "cmdDescTemplate"
  | "cmdDescSettings"
  | "qualityUncertain";

/**
 * Supported interface languages.
 * Matches the LANGUAGES array in apps/bot/src/constants.ts.
 */
export type SupportedLang = "en" | "ru" | "cs" | "de" | "fr" | "es" | "it" | "pt" | "uk" | "pl";

/**
 * A flat dictionary of i18n keys → localized strings.
 * Used internally by locale JSON files.
 */
export type LocaleMessages = Record<I18nKey, string>;

/**
 * Interpolation parameter map for keys that require parameters.
 * Ensures type safety for t() calls with parameters.
 */
export interface I18nParams {
  demoResult: { word: string };
  maxLangsReached: { max: string | number };
  langAdded: { lang: string };
  langRemoved: { lang: string };
  notificationTimeSet: { time: string };
  cefr: { level: string };
  register: { register: string };
  regenerateLang: { lang: string };
  regenerating: { lang: string };
  regenerated: { lang: string };
  translateModeOn: { fromLang: string; toLangs: string };
  partOfSpeech: { pos: string };
  expressionDetected: { expression: string };
  detectedLang: { lang: string };
  nextSourceSet: { lang: string };
  connotationWarning: { warning: string };
  templateCurrent: { name: string };
}

/**
 * @deprecated Use `SupportedLang` instead. Kept for backward compatibility.
 */
export type Locale = SupportedLang;
