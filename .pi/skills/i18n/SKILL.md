---
name: i18n
description: Internationalization of all bot texts. Provides typed t(key, lang, params?) function, locale files, and language utilities. Use when implementing or modifying bot text translations, adding new UI strings, or supporting new languages.
---

# i18n Agent Skill

## Module Location

`packages/core/src/modules/i18n/`

## Architecture Context

- **Layer:** Core (platform-independent, no I/O)
- **Dependencies:** None — leaf agent
- **Dependents:** `bot` agent uses `t()` for all user-facing text

## Current State

Fully implemented. Functional API (`t`, `getSupportedLangs`, `isSupported`) in `i18n.ts` with interpolation support (`{param}` placeholders). Legacy class-based `I18nService` in `i18n.service.ts` kept for backward compatibility. 3 locale files (en, ru, cs). 20 tests passing.

## Rules

1. Only `t(key, lang)` — no direct locale file imports from other modules
2. On missing key — fallback to `en`, never throw an error
3. Keys are a strict TypeScript enum — TS won't allow passing a non-existent key
4. Interpolation parameters are typed: `t("welcome", lang, { name: string })`
5. Locale files live in `packages/core/src/modules/i18n/locales/` as JSON

## Skills (Public API)

```typescript
// Main translation function
function t(key: I18nKey, lang: SupportedLang, params?: Record<string, string | number>): string;

// Get list of supported interface languages
function getSupportedLangs(): SupportedLang[];

// Type guard for language code
function isSupported(lang: string): lang is SupportedLang;
```

## Types

```typescript
// Strict enum of all i18n keys — derived from en.json (source of truth)
type I18nKey =
  | "welcome" | "choose_language" | "translate" | "dictionary" | "topics"
  | "settings" | "back" | "cancel" | "done" | "yes" | "no"
  | "chooseInterfaceLang" | "chooseNativeLang" | "chooseLearningLangs"
  | "enterWord" | "demoResult" | "onboardingComplete" | "onboardingCompleteNoSave"
  | "welcomeBack" | "maxLangsReached" | "selectAtLeastOne" | "langAdded"
  | "langRemoved" | "enterWordToTranslate" | "translating" | "translationError"
  | "translationUnavailable" | "translationNeedsReview" | "saveToDict"
  | "savedToDict" | "alreadySaved" | "wordDeleted" | "emptyDictionary"
  | "noResults" | "settingsUpdated" | "notificationTimeSet" | "flipCard"
  | "nextTranslation" | "editTranslation" | "saveToDictionary"
  | "cefr" | "register" | "synonyms" | "examples";

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
  cefr: { level: string };
  register: { register: string };
}

// Deprecated alias for SupportedLang
type Locale = SupportedLang;
```

## File Structure

```
packages/core/src/modules/i18n/
├── index.ts          # Re-exports: t, getSupportedLangs, isSupported, I18nService
├── types.ts          # I18nKey, SupportedLang, LocaleMessages, I18nParams, Locale
├── i18n.ts           # Functional API: t() with fallback + interpolation, getSupportedLangs, isSupported
├── i18n.service.ts   # Legacy class-based I18nService (deprecated, kept for backward compatibility)
├── locales/
│   ├── en.json       # English (source of truth for keys)
│   ├── ru.json
│   └── cs.json
└── __tests__/
    └── i18n.test.ts  # 20 tests
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (i18n section)
- Current temporary impl: `apps/bot/src/constants.ts`
