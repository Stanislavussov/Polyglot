---
name: i18n
description: Internationalization of all bot texts. Provides typed t(key, lang, params?) function, locale files, and language utilities. Use when implementing or modifying bot text translations, adding new UI strings, or supporting new languages.
---

# i18n Agent Skill

## Module Location

`packages/core/src/` — specifically the `modules/i18n/` subdirectory (to be created following the architecture in `docs/tech-reqs/02-architecture.md`).

## Architecture Context

- **Layer:** Core (platform-independent, no I/O)
- **Dependencies:** None — leaf agent
- **Dependents:** `bot` agent uses `t()` for all user-facing text

## Current State

A temporary `t()` function exists in `apps/bot/src/constants.ts` with inline `TEXTS` object. This must be replaced by a proper i18n module in `packages/core/src/`.

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
// Strict enum of all i18n keys — generated from en.json
type I18nKey = "chooseInterfaceLang" | "chooseNativeLang" | "chooseLearningLangs" | /* ... */ ;

// Supported languages
type SupportedLang = "en" | "ru" | "cs" | "de" | "fr" | "es" | "it" | "pt" | "uk" | "pl";
```

## File Structure

```
packages/core/src/modules/i18n/
├── index.ts          # Re-exports t, getSupportedLangs, isSupported
├── types.ts          # I18nKey, SupportedLang
├── i18n.ts           # Implementation of t() with fallback logic
└── locales/
    ├── en.json       # English (source of truth for keys)
    ├── ru.json
    └── cs.json
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (i18n section)
- Current temporary impl: `apps/bot/src/constants.ts`
