---
name: db
description: Database adapter using Drizzle ORM and PostgreSQL. Manages schema, migrations, repositories (User, Word, Topic, Language, WordContext), and singleton connection. Use when implementing or modifying database operations, schema changes, or repository methods.
---

# db Agent Skill

## Module Location

`packages/adapters/db/src/`

## Architecture Context

- **Layer:** Adapter (platform-dependent)
- **Dependencies:** None — leaf agent
- **Dependents:** `topics`, `notifications`, `bot`, `infra` agents consume repositories

## Current State

Fully implemented. All tables, repositories, singleton connection, and context-lookup factory in place.
- `schema.ts` — tables: `users`, `userLanguageSettings`, `words`, `translationRequests`, `topicTranslationCache`, `languages`, `wordContext`
- `index.ts` — singleton `getDb()`, `closeDb()`, re-exports all repositories, types, `createContextLookup`, and language cache functions (`loadLanguageCache`, `getLangDisplay`, `getSupportedLangs`, etc.)
- `context-lookup.ts` — `createContextLookup()` factory: wraps `wordContextRepository.findByWordAndLangCode()` + transforms DB rows to `DictionaryContext`. Fail-open (catches errors, returns `undefined`). Used by context-enrichment layer in core.
- `repositories/user.repository.ts` — findByTelegramId, create, updateSettings, getSettings, updateOnboardingStep, markOnboarded
- `repositories/word.repository.ts` — create, findByUser, findById, search, delete (soft), updateContent (partial regeneration)
- `repositories/topic.repository.ts` — getCached, setCached, markInvalid (topic translation caching)
- `repositories/language.repository.ts` — findByCode, create, getOrCreate, findAll (normalized language codes)
- `repositories/word-context.repository.ts` — findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById (offline dictionary data)

## Rules

1. No business logic — CRUD operations only
2. All queries typed via Drizzle — no raw SQL
3. Single connection instance — singleton `getDb()`
4. Each repository is a separate file with a single responsibility

## Skills (Public API)

### Constants

```typescript
/** Maximum number of learning languages per user (BRD §5, §12). */
MAX_LEARNING_LANGS = 4;
```

### UserRepository

```typescript
findByTelegramId(telegramId: number): Promise<User | null>;
create(data: NewUser): Promise<User>;
updateSettings(userId: number, settings: Omit<NewUserLanguageSettings, "userId">): Promise<UserLanguageSettings>;
  // Throws Error if settings.learningLangs.length > MAX_LEARNING_LANGS (4)
getSettings(userId: number): Promise<UserLanguageSettings | null>;
updateActiveMode(userId: number, mode: string): Promise<UserLanguageSettings | null>;
updateOnboardingStep(userId: number, step: number): Promise<User>;
markOnboarded(userId: number): Promise<User>;
  // Sets onboardingStep to 3 (BRD §5 — 3-step onboarding)
```

### WordRepository

```typescript
create(userId: number, word: Omit<NewWord, "userId">): Promise<Word>;
findByUser(userId: number): Promise<Word[]>;
findById(wordId: number): Promise<Word | null>;
search(userId: number, query: string): Promise<Word[]>;
updateContent(wordId: number, content: Record<string, unknown>): Promise<Word>;
delete(wordId: number): Promise<void>;  // soft delete
```

### TopicRepository

```typescript
getCached(topicId: string, original: string, sourceLang: string, targetLang: string): Promise<TopicTranslation | null>;
setCached(data: NewTopicTranslation): Promise<TopicTranslation>;
markInvalid(id: number, reason: string): Promise<void>;
```

### LanguageRepository

```typescript
findByCode(code: string): Promise<Language | null>;
create(data: NewLanguage): Promise<Language>;
getOrCreate(code: string, name: string): Promise<Language>;
findAll(): Promise<Language[]>;
```

### WordContextRepository

```typescript
findByWordAndLang(word: string, languageId: number): Promise<WordContext[]>;
findByWordAndLangCode(word: string, langCode: string): Promise<WordContext[]>;
search(query: string, languageId: number, limit?: number): Promise<WordContext[]>;
createBatch(entries: NewWordContext[]): Promise<number>;
countByLanguage(languageId: number): Promise<number>;
findById(id: number): Promise<WordContext | null>;
```

### Context Lookup Factory

```typescript
import type { ContextLookupFn } from "@polyglot/core";

/** Creates a ContextLookupFn wrapping wordContextRepository.findByWordAndLangCode() + DB→DictionaryContext transform. Fail-open. */
createContextLookup(): ContextLookupFn;
```

The returned function:
1. Queries `word_context` table by word + language code
2. Transforms the first result into `DictionaryContext` (`{ word, pos, glosses, formTags, langCode }`)
3. Returns `undefined` if no results or on error (fail-open)

This is the **single place** where DB → `DictionaryContext` transformation happens. All consumers use this factory via the context-enrichment layer instead of calling `wordContextRepository` directly for translation enrichment.

## Schema (current)

See `packages/adapters/db/src/schema.ts` for full Drizzle table definitions. Key tables:
- `users` — id, telegramId, username, onboardingStep, onboarded, isActive, createdAt
- `userLanguageSettings` — 1-to-1 with users, interfaceLang, nativeLang, learningLangs[], timezone, activeMode (default "translate"), isActive, updatedAt
- `words` — userId, original, sourceLang, content (JSONB with translations per target lang), isActive, createdAt, updatedAt
- `translationRequests` — userId, original, sourceLang, targetLangs[], createdAt (for rate limiting)
- `topicTranslationCache` — topicId, original, sourceLang, targetLang, content (JSONB), isValid, invalidReason, createdAt, updatedAt; unique index on (topicId, original, sourceLang, targetLang)
- `languages` — id, code (unique), name, createdAt; unique index on code. Normalized lookup for language codes (e.g. "ru" → "Russian")
- `wordContext` — id, word, languageId (FK → languages.id), pos, formTags (text[]), glosses (text[]), createdAt; indexes on (word, languageId) and (languageId). Offline dictionary data from Wiktionary JSONL

## Content JSONB Structure (words.content)

```json
{
  "cs": {
    "language": "Czech",
    "cefr_level": "B1",
    "translation": "...",
    "emoji": "🩺",
    "transcription": "[...]",
    "register": "neutral",
    "synonyms": [{ "word": "...", "register": "professional" }],
    "examples": [{ "context": "formal", "target": "...", "native": "..." }]
  }
}
```

## Types

```typescript
// Language types (inferred from schema — includes metadata columns from 0002 migration)
type Language = {
  id: number; code: string; name: string;
  nativeName: string | null; flag: string | null; iso3Code: string | null;
  isSupported: boolean; localizedNames: Record<string, string> | null;
  createdAt: Date | null;
};
type NewLanguage = {
  code: string; name: string;
  nativeName?: string | null; flag?: string | null; iso3Code?: string | null;
  isSupported?: boolean; localizedNames?: Record<string, string> | null;
  createdAt?: Date | null;
};

// WordContext types
type WordContext = { id: number; word: string; languageId: number; pos: string; formTags: string[] | null; glosses: string[] | null; createdAt: Date | null };
type NewWordContext = { word: string; languageId: number; pos: string; formTags?: string[]; glosses?: string[] };
```

## File Structure

```
packages/adapters/db/src/
├── index.ts                              # getDb(), closeDb(), re-exports (incl. createContextLookup + language cache)
├── schema.ts                             # Drizzle table definitions (users, userLanguageSettings, words, translationRequests, topicTranslationCache, languages, wordContext)
├── context-lookup.ts                     # ✅ createContextLookup() factory — DB→DictionaryContext transform, fail-open
├── language-cache.ts                     # ✅ loadLanguageCache(), getLang(), getLangDisplay(), getSupportedLangs(), normalizeToIso1(), etc. — in-memory cache loaded from languages table at startup
├── repositories/
│   ├── user.repository.ts                # ✅ implemented
│   ├── word.repository.ts                # ✅ implemented (+ updateContent for partial regen)
│   ├── topic.repository.ts               # ✅ implemented
│   ├── language.repository.ts            # ✅ implemented (findByCode, create, getOrCreate, findAll)
│   └── word-context.repository.ts        # ✅ implemented (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
└── __tests__/
    ├── getDb.test.ts                     # 1 test
    ├── user.repository.test.ts           # 18 tests (findByTelegramId, create, updateSettings incl. max-4 guard, getSettings, updateActiveMode, updateOnboardingStep, markOnboarded)
    ├── topic.repository.test.ts          # 4 tests
    ├── word.repository.test.ts           # 12 tests
    ├── language.repository.test.ts       # 7 tests (findByCode, create, getOrCreate, findAll)
    ├── word-context.repository.test.ts   # 13 tests (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
    └── context-lookup.test.ts            # 9 tests (factory returns fn, transforms result, no results→undefined, error→undefined, null glosses/formTags, multiple entries, langCode from arg)
```

## Migration

```
packages/adapters/db/drizzle/
├── 0000_purple_butterfly.sql             # Initial schema (users, userLanguageSettings, words, translationRequests)
├── 0001_parallel_thunderbolt.sql         # Adds languages, word_context, topic_translation_cache tables
├── 0002_languages_metadata.sql           # Language metadata columns + seed data
├── 0003_active_mode.sql                  # Adds active_mode column to user_language_settings
└── meta/
    ├── _journal.json
    ├── 0000_snapshot.json
    └── 0001_snapshot.json
```

## Reference

- DB schema spec: `docs/tech-reqs/05-db-schema.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Adapter contract: `docs/tech-reqs/04-adapter-contract.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (db section)
- Wiktionary JSONL task: `docs/tasks/13-wiktionary-jsonl.md`
