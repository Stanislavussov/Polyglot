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
- `schema.ts` — tables: `users`, `userLanguageSettings`, `words`, `translationRequests`, `translationRequestTargetLangs`, `topicTranslationCache`, `languages`, `wordContext`, `userTranslationTemplates`
- `index.ts` — singleton `getDb()`, `closeDb()`, re-exports all repositories (incl. `translationRequestRepository`), types, `createContextLookup`, and language cache functions (`loadLanguageCache`, `getLangDisplay`, `getSupportedLangs`, etc.)
- `context-lookup.ts` — `createContextLookup()` factory: wraps `wordContextRepository.findByWordAndLangCode()` + transforms DB rows to `DictionaryContext`. Fail-open (catches errors, returns `undefined`). Used by context-enrichment layer in core.
- `repositories/user.repository.ts` — findByTelegramId, create, updateSettings, getSettings, updateOnboardingStep, markOnboarded
- `repositories/word.repository.ts` — create (CreateWordInput), findByOriginalAndSource (dedup detection), findByUser, findById, search, delete (soft), updateContent (StoredWordContent typed). Exports StoredWordContent, StoredLanguageTranslation, CreateWordInput types.
- `repositories/topic.repository.ts` — getCached, setCached, markInvalid (topic translation caching)
- `repositories/language.repository.ts` — findByCode, create, getOrCreate, findAll (normalized language codes)
- `repositories/word-context.repository.ts` — findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById (offline dictionary data)

## Boundary

- **Mode:** role — when this skill is active, you ARE the DB agent. Only modify the database adapter layer.
- **Produces:** DB schema, repositories, migrations, and tests in `packages/adapters/db/src/`
- **Never:** modify code outside `packages/adapters/db/src/` and `packages/adapters/db/drizzle/`
- **Never:** contain business logic — only CRUD operations
- **Never:** use raw SQL — all queries via Drizzle ORM
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/adapters/db/src/**`, `packages/adapters/db/drizzle/**`

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
create(userId: number, input: CreateWordInput): Promise<Word>;
findByOriginalAndSource(userId: number, original: string, sourceLangId: number): Promise<Word | null>;
findByUser(userId: number): Promise<Word[]>;
findById(wordId: number): Promise<Word | null>;
search(userId: number, query: string): Promise<Word[]>;
updateContent(wordId: number, content: StoredWordContent): Promise<Word>;
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

### TranslationRequestRepository

```typescript
logTranslationRequest(userId: number, original: string, sourceLangCode: string | null, targetLangCodes: string[]): Promise<number>;
getUserRequestsInWindow(userId: number, windowStart: Date): Promise<number>;
getRecentRequests(userId: number, limit: number): Promise<TranslationRequestDTO[]>;
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

### TranslationTemplateRepository

```typescript
getByUserId(userId: number): Promise<SavedTranslationTemplate | null>;
  // Returns null if user has no custom template → caller falls back to DEFAULT_TEMPLATE
upsert(userId: number, name: string, fields: TemplateFields): Promise<SavedTranslationTemplate>;
  // Creates or updates the user's template. Validates all 6 TemplateFields are booleans.
  // Throws if fields have invalid types or missing keys.
deleteByUserId(userId: number): Promise<void>;
  // Deletes user's custom template (reset to default)
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
- `words` — userId, original, sourceLang (nullable, deprecated), sourceLangId (FK → languages.id, NOT NULL), inputType ('word'|'phrase', default 'word'), content (JSONB typed as StoredWordContent), isActive, createdAt, updatedAt; unique index on (userId, original, sourceLangId)
- `translationRequests` — userId, original, sourceLangId (FK → languages.id, nullable), createdAt (for rate limiting)
- `translationRequestTargetLangs` — requestId (FK → translationRequests.id), languageId (FK → languages.id); unique index on (requestId, languageId)
- `topicTranslationCache` — topicId, original, sourceLang, targetLang, content (JSONB), isValid, invalidReason, createdAt, updatedAt; unique index on (topicId, original, sourceLang, targetLang)
- `languages` — id, code (unique), name, createdAt; unique index on code. Normalized lookup for language codes (e.g. "ru" → "Russian")
- `wordContext` — id, word, languageId (FK → languages.id), pos, formTags (text[]), glosses (text[]), createdAt; indexes on (word, languageId) and (languageId). Offline dictionary data from Wiktionary JSONL
- `userTranslationTemplates` — id, userId (FK → users.id, unique, cascade), name (text, default 'Custom'), transcription (bool, default true), synonyms (bool, default true), examples (bool, default true), alternatives (bool, default true), equivalentNote (bool, default true), connotationWarning (bool, default true), createdAt, updatedAt; unique index on userId. 1-to-1 with users — customizable output template. Individual columns (not JSONB) for type safety and schema evolution.

## Content JSONB Structure (words.content — typed as StoredWordContent)

```typescript
interface StoredWordContent {
  emoji: string;
  register: Register;
  translations: Record<string, StoredLanguageTranslation>;
}

interface StoredLanguageTranslation {
  text: string;
  cefr: CefrLevel;
  transcription?: string;
  register: Register;
  synonyms: Synonym[];
  examples: Example[];
  alternatives?: TranslationVariant[];
  expressionType?: ExpressionType;
  equivalentNote?: string;
  connotationWarning?: string;  // Task 31: optional warning for dangerous/misleading meanings
}

interface CreateWordInput {
  original: string;
  sourceLangId: number;
  inputType: 'word' | 'phrase';
  content: StoredWordContent;
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

// TranslationRequestDTO (returned by getRecentRequests — language codes, not IDs)
type TranslationRequestDTO = {
  id: number; userId: number; original: string;
  sourceLangCode: string | null; targetLangCodes: string[];
  createdAt: Date;
};

// WordContext types
type WordContext = { id: number; word: string; languageId: number; pos: string; formTags: string[] | null; glosses: string[] | null; createdAt: Date | null };
type NewWordContext = { word: string; languageId: number; pos: string; formTags?: string[]; glosses?: string[] };

// TemplateFields — imported from @polyglot/core (Task 32). DB stores as individual boolean columns, not JSONB.
// TemplateFields = { transcription: boolean; synonyms: boolean; examples: boolean; alternatives: boolean; equivalentNote: boolean; connotationWarning: boolean };
type SavedTranslationTemplate = { id: number; userId: number; name: string; fields: TemplateFields; createdAt: Date; updatedAt: Date };

// StoredWordContent types (FEAT-30 — typed JSONB for words.content)
// See word.repository.ts for full interface definitions
// Imports CefrLevel, Example, ExpressionType, Register, Synonym, TranslationVariant from @polyglot/core
type StoredWordContent = { emoji: string; register: Register; translations: Record<string, StoredLanguageTranslation> };
type StoredLanguageTranslation = { text: string; cefr: CefrLevel; transcription?: string; register: Register; synonyms: Synonym[]; examples: Example[]; alternatives?: TranslationVariant[]; expressionType?: ExpressionType; equivalentNote?: string; connotationWarning?: string };
type CreateWordInput = { original: string; sourceLangId: number; inputType: 'word' | 'phrase'; content: StoredWordContent };
```

## File Structure

```
packages/adapters/db/src/
├── index.ts                              # getDb(), closeDb(), re-exports (incl. createContextLookup + language cache)
├── schema.ts                             # Drizzle table definitions (users, userLanguageSettings, words, translationRequests, translationRequestTargetLangs, topicTranslationCache, languages, wordContext)
├── context-lookup.ts                     # ✅ createContextLookup() factory — DB→DictionaryContext transform, fail-open
├── language-cache.ts                     # ✅ loadLanguageCache(), getLang(), getLangDisplay(), getSupportedLangs(), normalizeToIso1(), etc. — in-memory cache loaded from languages table at startup
├── repositories/
│   ├── user.repository.ts                # ✅ implemented
│   ├── word.repository.ts                # ✅ implemented (+ updateContent for partial regen)
│   ├── topic.repository.ts               # ✅ implemented
│   ├── language.repository.ts            # ✅ implemented (findByCode, create, getOrCreate, findAll)
│   ├── translation-request.repository.ts  # ✅ implemented (logTranslationRequest, getUserRequestsInWindow, getRecentRequests)
│   ├── translation-template.repository.ts # ✅ implemented (getByUserId, upsert, deleteByUserId — Task 32)
│   └── word-context.repository.ts        # ✅ implemented (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
└── __tests__/
    ├── getDb.test.ts                     # 1 test
    ├── user.repository.test.ts           # 18 tests (findByTelegramId, create, updateSettings incl. max-4 guard, getSettings, updateActiveMode, updateOnboardingStep, markOnboarded)
    ├── topic.repository.test.ts          # 4 tests
    ├── word.repository.test.ts           # 20 tests (create with CreateWordInput, findByOriginalAndSource, findByUser, findById, search, updateContent with StoredWordContent, delete, connotationWarning support)
    ├── language.repository.test.ts       # 7 tests (findByCode, create, getOrCreate, findAll)
    ├── word-context.repository.test.ts   # 13 tests (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
    ├── translation-request.repository.test.ts # 11 tests (logTranslationRequest, getUserRequestsInWindow, getRecentRequests)
    ├── translation-template.repository.test.ts # 12 tests (getByUserId, upsert, deleteByUserId, field normalization, validation — Task 32)
    └── context-lookup.test.ts            # 9 tests (factory returns fn, transforms result, no results→undefined, error→undefined, null glosses/formTags, multiple entries, langCode from arg)
```

## Migration

```
packages/adapters/db/drizzle/
├── 0000_purple_butterfly.sql             # Initial schema (users, userLanguageSettings, words, translationRequests)
├── 0001_parallel_thunderbolt.sql         # Adds languages, word_context, topic_translation_cache tables
├── 0002_languages_metadata.sql           # Language metadata columns + seed data
├── 0003_active_mode.sql                  # Adds active_mode column to user_language_settings
├── 0004_link_translation_requests_languages.sql # Links translation_requests to languages via FK + junction table
├── 0005_words_dictionary_improvements.sql # Adds source_lang_id FK, input_type column, dedup unique index; deprecates source_lang text
├── 0006_drop_words_source_lang.sql       # Drops deprecated source_lang text column from words
├── 0007_drop_iso3_code.sql               # Drops iso3_code column from languages
├── 0008_user_translation_templates.sql   # Adds user_translation_templates table (Task 32)
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
