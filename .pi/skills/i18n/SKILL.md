---
name: i18n
description: Internationalization of all bot texts. Provides typed t(key, lang, params?) function, locale files, language name registry, and language utilities. Use when implementing or modifying bot text translations, adding new UI strings, or supporting new languages.
---

# i18n Agent Skill

## Module Location

`packages/core/src/modules/i18n/`

## Architecture Context

- **Layer:** Core (platform-independent, no I/O)
- **Dependencies:** None — leaf agent
- **Dependents:** `bot` agent uses `t()` for all user-facing text; `infra` and `db` use language name registry

## Current State

Fully implemented. Functional API (`t`, `getSupportedLangs`, `isSupported`) in `i18n.ts` with interpolation support (`{param}` placeholders). Language name registry (`getLanguageName`, `getLanguageNativeName`, `getAllLanguageNames`, `isKnownLanguage`) in `language-registry.ts` for Wiktionary integration and bot UI. Legacy class-based `I18nService` in `i18n.service.ts` kept for backward compatibility. 3 locale files (en, ru, cs). 175 tests passing (154 i18n + 17 language names + 4 language codes). Task 07 regeneration keys added. Task 09 translate mode keys added. Task 13 Wiktionary dictionary context keys (`wiktionaryDefinition`, `wiktionarySource`, `partOfSpeech`, `expressionDetected`, `dictionaryContext`) and language name registry added. `phraseDetected` and `idiomDetected` unified into `expressionDetected` with `{ expression: string }` params. Task 16 auto-detect input language key added: `detectedLang` with `{ lang: string }` params for displaying detected source language in translation cards. Task 17 post-translation source language selection keys added: `nextTranslationFrom` (header text) and `nextSourceSet` with `{ lang: string }` params for confirmation when user selects source language. Task 27 sentence translation label key added: `sentenceTranslation` (no params) for labeling compact sentence translation cards. Task 30 save-to-dictionary button labels added: `saveWord` (no params) and `savePhrase` (no params) for contextual Save button labels based on input type. Task 31 connotation warning key added: `connotationWarning` with `{ warning: string }` params for rendering `⚠️` connotation warnings on translation cards. Task 32 template wizard keys added: 18 keys for the translation template constructor wizard (`templateTitle`, `templateCurrent` with `{ name: string }` params, `templateDefault`, `templateCustom`, `templateCustomize`, `templateReset`, `templateConstructor`, `templatePreview`, `templateSave`, `templateCancel`, `templateBack`, `templateSaved`, `templateResetDone`, `templateCancelled`, `templateFieldTranscription`, `templateFieldSynonyms`, `templateFieldExamples`, `templateFieldAlternatives`, `templateFieldEquivalentNote`, `templateFieldConnotationWarning`, `templatePreviewHeader`, `templateSessionExpired`). Task 35 bot command description keys added: 5 keys (`cmdDescStart`, `cmdDescTranslate`, `cmdDescDictionary`, `cmdDescTemplate`, `cmdDescSettings`) for localized Telegram `/` menu command descriptions, no params. Task 37 lite AI translation validator key added: `qualityUncertain` (no params) for displaying "⚠️ Translation quality uncertain" indicator on flagged words in dictionary/flashcard views. Task 33 flash card keys added: 15 keys for the dictionary word pipeline flash card UI (`flashcardStart` with `{ count: string | number }` params, `flashcardStartBtn`, `flashcardEmpty`, `flashcardReveal`, `flashcardNext`, `flashcardDone` with `{ count: string | number }` params, `flashcardQuit`, `flashcardRestart`, `flashcardClose`, `flashcardProgress` with `{ current: string | number; total: string | number }` params, `flashcardQuitBtn`, `flashcardDoneBtn`, `flashcardNewDeckBtn`, `flashcardSessionExpired`, `cmdDescFlashcard`).

Task 40 dictionary browse/delete keys added: 11 keys for the `/dictionary` paginated browse UI (`dictionaryHeader` with `{ count: string | number }` params, `dictionaryPage` with `{ page: string | number; total: string | number }` params, `dictionaryPrev`, `dictionaryNext`, `dictionaryClose`, `dictionaryBack`, `dictionaryDelete`, `dictionaryDeleteConfirm` with `{ word: string }` params, `dictionaryDeleteYes`, `dictionaryDeleteCancel`, `dictionarySessionExpired`).

Task 37 settings command keys added: 15 keys for the `/settings` command UI (`settingsTitle`, `settingsNativeLang` with `{ lang: string }` params, `settingsLearningLangs` with `{ langs: string }` params, `settingsInterfaceLang` with `{ lang: string }` params, `settingsChangeNative`, `settingsChangeLearning`, `settingsChangeInterface`, `settingsClose`, `settingsChooseNative`, `settingsChooseLearning`, `settingsChooseInterface`, `settingsNativeUpdated` with `{ lang: string }` params, `settingsLearningUpdated`, `settingsInterfaceUpdated` with `{ lang: string }` params, `settingsSessionExpired`).

**BUG-01 fix applied:** Removed `chooseInterfaceLang` and `onboardingCompleteNoSave` keys (interface language step removed from onboarding, Save/Skip prompt removed from demo step). Updated `demoResult` to show result immediately without save prompt. Onboarding now 3 steps: native lang → learning langs → demo translation.

## Boundary

- **Mode:** role — when this skill is active, you ARE the i18n agent. Only modify the internationalization module.
- **Produces:** i18n source code, locale files, and tests in `packages/core/src/modules/i18n/`
- **Never:** modify code outside `packages/core/src/modules/i18n/`
- **Never:** import locale files directly from other modules — all access via `t()` function
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/core/src/modules/i18n/**`

## Rules

1. Only `t(key, lang)` — no direct locale file imports from other modules
2. On missing key — fallback to `en`, never throw an error
3. Keys are a strict TypeScript enum — TS won't allow passing a non-existent key
4. Interpolation parameters are typed: `t("welcome", lang, { name: string })`
5. Locale files live in `packages/core/src/modules/i18n/locales/` as JSON
6. Language name lookups via `getLanguageName()` — no direct map imports from other modules

## Skills (Public API)

```typescript
// Main translation function
function t(key: I18nKey, lang: SupportedLang, params?: Record<string, string | number>): string;

// Get list of supported interface languages
function getSupportedLangs(): SupportedLang[];

// Type guard for language code
function isSupported(lang: string): lang is SupportedLang;

// Language registry — initialized from DB at startup (Task 13+)
function initLanguageRegistry(entries: LanguageEntry[]): void;
function isRegistryInitialized(): boolean;
function getLanguageName(code: string, displayLang?: SupportedLang): string;
function getLanguageNativeName(code: string): string;
function getAllLanguageNames(): Array<{ code: string; name: string }>;
function isKnownLanguage(code: string): boolean;
function getIso1ToIso3Map(): Record<string, string>;
function getIso3ToIso1Map(): Record<string, string>;
function resolveToIso3(lang: string): string | undefined;
function normalizeToIso1(lang: string): string | undefined;
function getLangFlag(code: string): string | undefined;
function getLangDisplay(code: string): string;
function getSupportedLanguages(): LanguageEntry[];
```

## Types

```typescript
// Strict enum of all i18n keys — derived from en.json (source of truth)
type I18nKey =
  | "welcome" | "choose_language" | "translate" | "dictionary" | "topics"
  | "settings" | "back" | "cancel" | "done" | "yes" | "no"
  | "chooseNativeLang" | "chooseLearningLangs"
  | "enterWord" | "demoResult" | "onboardingComplete"
  | "welcomeBack" | "maxLangsReached" | "selectAtLeastOne" | "langAdded"
  | "langRemoved" | "enterWordToTranslate" | "translating" | "translationError"
  | "translationUnavailable" | "translationNeedsReview" | "saveToDict"
  | "savedToDict" | "alreadySaved" | "wordDeleted" | "emptyDictionary"
  | "noResults" | "settingsUpdated" | "notificationTimeSet" | "flipCard"
  | "nextTranslation" | "editTranslation" | "saveToDictionary"
  | "register" | "synonyms" | "examples"
  | "regenerateLang" | "regenerating" | "regenerated"
  | "translateModeOn" | "translateModeHint"
  | "wiktionaryDefinition" | "wiktionarySource" | "partOfSpeech"
  | "expressionDetected" | "dictionaryContext"
  | "detectedLang"
  | "nextTranslationFrom" | "nextSourceSet"
  | "sentenceTranslation"
  | "saveWord" | "savePhrase"
  | "connotationWarning"
  | "templateTitle" | "templateCurrent" | "templateDefault" | "templateCustom"
  | "templateCustomize" | "templateReset" | "templateConstructor"
  | "templatePreview" | "templateSave" | "templateCancel" | "templateBack"
  | "templateSaved" | "templateResetDone" | "templateCancelled"
  | "templateFieldTranscription" | "templateFieldSynonyms" | "templateFieldExamples"
  | "templateFieldAlternatives" | "templateFieldEquivalentNote"
  | "templateFieldConnotationWarning" | "templatePreviewHeader" | "templateSessionExpired"
  | "cmdDescStart" | "cmdDescTranslate" | "cmdDescDictionary"
  | "cmdDescTemplate" | "cmdDescSettings"
  | "qualityUncertain"
  | "flashcardStart" | "flashcardStartBtn" | "flashcardEmpty"
  | "flashcardReveal" | "flashcardNext" | "flashcardDone"
  | "flashcardQuit" | "flashcardRestart" | "flashcardClose"
  | "flashcardProgress" | "flashcardQuitBtn" | "flashcardDoneBtn"
  | "flashcardNewDeckBtn" | "flashcardSessionExpired"
  | "cmdDescFlashcard"
  | "dictionaryHeader" | "dictionaryPage" | "dictionaryPrev" | "dictionaryNext"
  | "dictionaryClose" | "dictionaryBack" | "dictionaryDelete"
  | "dictionaryDeleteConfirm" | "dictionaryDeleteYes" | "dictionaryDeleteCancel"
  | "dictionarySessionExpired"
  | "settingsTitle" | "settingsNativeLang" | "settingsLearningLangs"
  | "settingsInterfaceLang" | "settingsChangeNative" | "settingsChangeLearning"
  | "settingsChangeInterface" | "settingsClose" | "settingsChooseNative"
  | "settingsChooseLearning" | "settingsChooseInterface"
  | "settingsNativeUpdated" | "settingsLearningUpdated"
  | "settingsInterfaceUpdated" | "settingsSessionExpired";

// Supported languages
type SupportedLang = "en" | "ru" | "cs" | "de" | "fr" | "es" | "it" | "pt" | "uk" | "pl";

// Flat dictionary of i18n keys → localized strings
type LocaleMessages = Record<I18nKey, string>;

// Interpolation parameter map for keys that require parameters
interface I18nParams {
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
}

// Deprecated alias for SupportedLang
type Locale = SupportedLang;
```

## File Structure

```
packages/core/src/modules/i18n/
├── index.ts              # Re-exports: t, getSupportedLangs, isSupported, language-names, I18nService
├── types.ts              # I18nKey, SupportedLang, LocaleMessages, I18nParams, Locale
├── i18n.ts               # Functional API: t() with fallback + interpolation, getSupportedLangs, isSupported
├── i18n.service.ts       # Legacy class-based I18nService (deprecated, kept for backward compatibility)
├── language-registry.ts  # Language registry: initLanguageRegistry, getLanguageName, getLanguageNativeName, getAllLanguageNames, isKnownLanguage, getLangDisplay, getLangFlag, resolveToIso3, normalizeToIso1, getSupportedLanguages
├── locales/
│   ├── en.json           # English (source of truth for keys)
│   ├── ru.json
│   └── cs.json
└── __tests__/
    ├── i18n.test.ts           # 154 tests (t(), getSupportedLangs, isSupported, locale consistency, qualityUncertain, flashcard keys, dictionary browse keys, settings command keys)
    ├── language-names.test.ts # 17 tests (getLanguageName, getLanguageNativeName, getAllLanguageNames, isKnownLanguage)
    └── language-codes.test.ts # 4 tests (resolveToIso3, normalizeToIso1, getIso1ToIso3Map, getIso3ToIso1Map)
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (i18n section)
- Task 13: `docs/tasks/13-wiktionary-jsonl.md` (Wiktionary JSONL Integration)
