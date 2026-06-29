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
  | "contextMarkerNeedsText"
  | "inputRejectedEmpty"
  | "inputRejectedCommand"
  | "inputRejectedDigits"
  | "inputRejectedTooLong"
  | "translationNeedsReview"
  | "saveToDict"
  | "savedToDict"
  | "alreadySaved"
  | "alreadySavedButton"
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
  | "clarifyTranslation"
  | "otherMeaning"
  | "clarifyTranslationPrompt"
  | "regeneratingAll"
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
  | "inputTypeWord"
  | "inputTypePhrase"
  | "inputTypeSentence"
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
  | "templateFieldSynonyms"
  | "templateFieldExamples"
  | "templateFieldAlternatives"
  | "templateFieldEquivalentNote"
  | "templateFieldConnotationWarning"
  | "templateFieldGrammarBreakdown"
  | "templatePreviewHeader"
  | "templateSessionExpired"
  | "cmdDescStart"
  | "cmdDescTranslate"
  | "cmdDescMentor"
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
  | "cmdDescReview"
  | "srsEmpty"
  | "srsProgress"
  | "srsReveal"
  | "srsChooseRating"
  | "srsAgain"
  | "srsHard"
  | "srsGood"
  | "srsEasy"
  | "srsScheduled"
  | "srsDone"
  | "srsQuit"
  | "srsQuitBtn"
  | "srsNewSessionBtn"
  | "srsClose"
  | "srsSessionExpired"
  | "dictionaryHeader"
  | "dictionaryNamedHeader"
  | "dictionaryPage"
  | "dictionaryPrev"
  | "dictionaryNext"
  | "dictionaryClose"
  | "dictionaryBack"
  | "dictionarySwitch"
  | "dictionarySwitcherTitle"
  | "dictionarySwitcherItem"
  | "dictionaryDefaultMark"
  | "dictionaryCreate"
  | "dictionaryCreatePrompt"
  | "dictionaryCreated"
  | "dictionaryRename"
  | "dictionaryRenamePrompt"
  | "dictionaryRenamed"
  | "dictionaryNameInvalid"
  | "dictionaryDeleteCollection"
  | "dictionaryDeleteCollectionConfirm"
  | "dictionaryAddTo"
  | "dictionaryMoveTo"
  | "dictionaryAddToPrompt"
  | "dictionaryMoveToPrompt"
  | "dictionaryNoOtherDictionaries"
  | "dictionaryEntryAdded"
  | "dictionaryEntryMoved"
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
  | "settingsPlan"
  | "settingsPlanUnlimited"
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
  | "notifReveal"
  | "notifLearned"
  | "notifRemoved"
  | "notifTypeSrs"
  | "notifTypeSuggested"
  | "notifTypeBoth"
  | "notifTypeContextual"
  | "notifContextualSentence"
  | "settingsNotifSection"
  | "settingsNotifEnabled"
  | "settingsNotifDisabled"
  | "settingsNotifTimes"
  | "settingsNotifTimeAdded"
  | "settingsNotifTimeRemoved"
  | "settingsNotifTimesMax"
  | "settingsNotifType"
  | "settingsNotifTimezone"
  | "settingsNotifToggle"
  | "settingsNotifManage"
  | "settingsNotifSubTitle"
  | "settingsNotifStatusOn"
  | "settingsNotifStatusOff"
  | "settingsNotifEnable"
  | "settingsNotifDisable"
  | "settingsNotifChooseTimes"
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
  | "cmdDescChanges"
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
  | "mistypeCancel"
  | "langSelectPrompt"
  | "translationClarifyPrompt"
  | "translationClarifyReasonLanguage"
  | "translationClarifyReasonMeaning"
  | "translationClarifyReasonFormat"
  | "translationClarifyContextButton"
  | "translationClarifyContextPrompt"
  | "rateLimitExceeded"
  | "mentorModeOn"
  | "mentorThinking"
  | "mentorError"
  | "mentorInputTooLong"
  | "grammarBreakdown"
  | "grammarBreakdownButton"
  | "grammarLocked"
  | "grammarDetailButton"
  | "grammarDetailLocked"
  | "grammarDetailCancel"
  | "etymology"
  | "etymologySection"
  | "etymologyLocked"
  | "cmdDescVideos"
  | "videoDuration"
  | "videoLanguage"
  | "videoRemaining"
  | "videoExtract"
  | "videoCancel"
  | "videoProcessingStarted"
  | "videoProcessingDone"
  | "videoProcessingFailed"
  | "videoOnlyYouTube"
  | "videoNoSubtitles"
  | "videoLimitReached"
  | "videoAlreadyProcessing"
  | "videoMetadataError"
  | "videoMyVideos"
  | "videoNoVideos"
  | "videoNoPhrases"
  | "videoBrowse"
  | "dictionaryTranslate"
  | "videoSaveAll"
  | "videoClose"
  | "videoPhraseNotFound"
  | "videoAlreadySaved"
  | "videoLanguageNotFound"
  | "videoDurationUnknown"
  | "videoTypeWord"
  | "videoTypePhrase"
  | "videoPage"
  | "videoSavedToast"
  | "videoProcessingCancelled"
  | "videoPhrasesExtracted"
  | "chooseProficiencyLevel";

/**
 * Supported interface languages.
 * Matches the LANGUAGES array in apps/bot/src/constants.ts.
 */
export type SupportedLang = "en" | "ru" | "cs" | "de" | "fr" | "es" | "it" | "pt" | "uk" | "pl" | "kk";

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
  srsDone: { count: string | number };
  srsProgress: { current: string | number; total: string | number };
  dictionaryHeader: { count: string | number };
  dictionaryNamedHeader: { name: string; count: string | number };
  dictionaryPage: { page: string | number; total: string | number };
  dictionarySwitcherItem: { name: string; count: string | number };
  dictionaryCreated: { name: string };
  dictionaryRenamePrompt: { name: string };
  dictionaryRenamed: { name: string };
  dictionaryNameInvalid: { max: string | number };
  dictionaryDeleteCollectionConfirm: { name: string };
  dictionaryEntryAdded: { name: string };
  dictionaryEntryMoved: { name: string };
  dictionaryDeleteConfirm: { word: string };
  settingsNativeLang: { lang: string };
  settingsLearningLangs: { langs: string };
  settingsInterfaceLang: { lang: string };
  settingsPlan: { plan: string; remaining: string | number; limit: string | number };
  settingsPlanUnlimited: { plan: string };
  settingsNativeUpdated: { lang: string };
  settingsInterfaceUpdated: { lang: string };
  settingsNotifTime: { time: string };
  settingsNotifType: { type: string };
  settingsNotifTimezone: { timezone: string };
  settingsNotifContext: { context: string };
  settingsNotifContextPrompt: { current: string };
  settingsNotifContextSaved: { context: string };
  notifRemoved: { word: string };
  mistypeWarning: { word: string };
  langSelectPrompt: { word: string };
  chooseProficiencyLevel: { lang: string };
  videoPage: { page: string | number; total: string | number };
  videoPhrasesExtracted: { count: string | number };
}

/**
 * @deprecated Use `SupportedLang` instead. Kept for backward compatibility.
 */
export type Locale = SupportedLang;
