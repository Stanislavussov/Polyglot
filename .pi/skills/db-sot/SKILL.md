---
name: db-sot
description: Database source-of-truth policy. Defines which DB tables own which domain values and how all layers must consume them. Read when implementing anything that touches languages, user modes, settings, or domain enumerations.
---

# DB Source of Truth

The database schema (`packages/adapters/db/src/schema.ts`) is the single source of truth for all domain values. Adding a new language, mode, or domain value requires ONLY a DB migration + seed — application code picks it up automatically.

## Languages

| What | Where |
|------|-------|
| **Table** | `languages` — code, name, nativeName, flag, iso3Code, isSupported, localizedNames |
| **Cache** | `language-cache.ts` loads all rows at startup |
| **Availability** | `languages.isSupported` column determines which languages appear in UI |

**Runtime API** (from `@polyglot/adapter-db`):

```typescript
getSupportedLangs()   // languages where isSupported = true
getLang(code)         // full CachedLanguage by ISO 639-1
getLangName(code)     // English name (or localized)
getLangNativeName(code)
getLangFlag(code)     // emoji flag from DB
getLangDisplay(code)  // "🇷🇺 Русский"
isKnownLang(code)    // is in DB at all
getIso3(code)        // ISO 639-1 → 639-3
getIso1FromIso3(iso3) // reverse
normalizeToIso1(lang) // any recognized form → ISO 639-1
```

## User Modes

| What | Where |
|------|-------|
| **Column** | `userLanguageSettings.activeMode` (default: `"translate"`) |
| **Constants** | `DEFAULT_ACTIVE_MODE` exported from db layer |

## Domain Constants

| Constant | Source |
|----------|--------|
| `MAX_LEARNING_LANGS` | db layer export |
| `DEFAULT_ACTIVE_MODE` | `userLanguageSettings.activeMode` column default |
| `DEFAULT_TIMEZONE` | `userLanguageSettings.timezone` column default |

All constants live in the `db` layer and are re-exported for other layers.

## Content JSONB

- `words.content` keys = language codes matching `languages.code`
- `topicTranslationCache.sourceLang` / `targetLang` = `languages.code`

## Anti-Patterns — NEVER Do

| ❌ Don't | ✅ Do Instead |
|----------|--------------|
| `type SupportedLang = "en" \| "ru" \| "cs" \| ...` | Use `getSupportedLangs()` from DB cache |
| `const SUPPORTED_LANGS = ["en", "ru", ...]` | Use `getSupportedLangs()` |
| `const VALID_MODES = new Set(["idle", "translate"])` | Import `DEFAULT_ACTIVE_MODE` from db layer |
| `if (mode === "translate")` scattered in code | Use imported constant |
| Hardcoded ISO 639-1↔639-3 maps | Use `getIso3()` / `getIso1FromIso3()` |
| Hardcoded language code → name map in prompts | Use `getLangName(code)` |
