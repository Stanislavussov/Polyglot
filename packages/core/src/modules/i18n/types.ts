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
  | "qualityUncertain"
  | "flashcardStart"
  | "flashcardStartBtn"
  | "flashcardEmpty"
  | "flashcardReveal"
  | "flashcardNext"
  | "flashcardDone"
  | "flashcardQuit"
  | "flashcardRestart"
  | "flashcardClose"
  | "flashcardProgress"
  | "flashcardQuitBtn"
  | "flashcardDoneBtn"
  | "flashcardNewDeckBtn"
  | "flashcardSessionExpired"
  | "cmdDescFlashcard"
  | "dictionaryHeader"
  | "dictionaryPage"
  | "dictionaryPrev"
  | "dictionaryNext"
  | "dictionaryClose"
  | "dictionaryBack"
  | "dictionaryDelete"
  | "dictionaryDeleteConfirm"
  | "dictionaryDeleteYes"
  | "dictionaryDeleteCancel"
  | "dictionarySessionExpired"
  | "textOnly"
  | "emojiNotSupported"
  | "settingsTitle"
  | "settingsNativeLang"
  | "settingsLearningLangs"
  | "settingsInterfaceLang"
  | "settingsChangeNative"
  | "settingsChangeLearning"
  | "settingsChangeInterface"
  | "settingsClose"
  | "settingsChooseNative"
  | "settingsChooseLearning"
  | "settingsChooseInterface"
  | "settingsNativeUpdated"
  | "settingsLearningUpdated"
  | "settingsInterfaceUpdated"
  | "settingsSessionExpired"
  | "notifTitle"
  | "notifWordFromDict"
  | "notifAiSuggested"
  | "notifTranslations"
  | "notifOpenDict"
  | "notifSkip"
  | "notifTypeSrs"
  | "notifTypeSuggested"
  | "notifTypeBoth"
  | "notifTypeContextual"
  | "notifContextualSentence"
  | "settingsNotifSection"
  | "settingsNotifEnabled"
  | "settingsNotifDisabled"
  | "settingsNotifTime"
  | "settingsNotifType"
  | "settingsNotifTimezone"
  | "settingsNotifToggle"
  | "settingsNotifManage"
  | "settingsNotifSubTitle"
  | "settingsNotifStatusOn"
  | "settingsNotifStatusOff"
  | "settingsNotifEnable"
  | "settingsNotifDisable"
  | "settingsNotifChooseTime"
  | "settingsNotifChooseType"
  | "settingsNotifChooseTimezone"
  | "settingsNotifChooseContext"
  | "settingsNotifContext"
  | "settingsNotifContextNotSet"
  | "settingsNotifContextPrompt"
  | "settingsNotifContextCancel"
  | "settingsNotifContextSaved"
  | "notifPaused"
  | "notifReEngagement"
  | "cmdDescReport"
  | "reportTitle"
  | "reportChooseType"
  | "reportBug"
  | "reportSuggestion"
  | "reportOther"
  | "reportEnterDescription"
  | "reportPreview"
  | "reportSend"
  | "reportEdit"
  | "reportCancel"
  | "reportSent"
  | "reportCancelled"
  | "reportTooLong"
  | "mistypeWarning"
  | "mistypeConfirm"
  | "mistypeCancel";

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
  flashcardStart: { count: string | number };
  flashcardDone: { count: string | number };
  flashcardProgress: { current: string | number; total: string | number };
  dictionaryHeader: { count: string | number };
  dictionaryPage: { page: string | number; total: string | number };
  dictionaryDeleteConfirm: { word: string };
  settingsNativeLang: { lang: string };
  settingsLearningLangs: { langs: string };
  settingsInterfaceLang: { lang: string };
  settingsNativeUpdated: { lang: string };
  settingsInterfaceUpdated: { lang: string };
  settingsNotifTime: { time: string };
  settingsNotifType: { type: string };
  settingsNotifTimezone: { timezone: string };
  settingsNotifContext: { context: string };
  settingsNotifContextPrompt: { current: string };
  settingsNotifContextSaved: { context: string };
  mistypeWarning: { word: string };
}

/**
 * @deprecated Use `SupportedLang` instead. Kept for backward compatibility.
 */
export type Locale = SupportedLang;
