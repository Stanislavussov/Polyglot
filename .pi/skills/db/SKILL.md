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

Fully implemented. All tables, repositories, and singleton connection in place.
- `schema.ts` — tables: `users`, `userLanguageSettings`, `words`, `translationRequests`, `topicTranslationCache`, `languages`, `wordContext`
- `index.ts` — singleton `getDb()`, `closeDb()`, re-exports all repositories and types
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

### UserRepository

```typescript
findByTelegramId(telegramId: number): Promise<User | null>;
create(data: NewUser): Promise<User>;
updateSettings(userId: number, settings: Omit<NewUserLanguageSettings, "userId">): Promise<UserLanguageSettings>;
getSettings(userId: number): Promise<UserLanguageSettings | null>;
updateOnboardingStep(userId: number, step: number): Promise<User>;
markOnboarded(userId: number): Promise<User>;
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

## Schema (current)

See `packages/adapters/db/src/schema.ts` for full Drizzle table definitions. Key tables:
- `users` — id, telegramId, username, onboardingStep, onboarded, isActive, createdAt
- `userLanguageSettings` — 1-to-1 with users, interfaceLang, nativeLang, learningLangs[], timezone, isActive, updatedAt
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
// Language types
type Language = { id: number; code: string; name: string; createdAt: Date | null };
type NewLanguage = { code: string; name: string; createdAt?: Date };

// WordContext types
type WordContext = { id: number; word: string; languageId: number; pos: string; formTags: string[] | null; glosses: string[] | null; createdAt: Date | null };
type NewWordContext = { word: string; languageId: number; pos: string; formTags?: string[]; glosses?: string[] };
```

## File Structure

```
packages/adapters/db/src/
├── index.ts                              # getDb(), closeDb(), re-exports
├── schema.ts                             # Drizzle table definitions (users, userLanguageSettings, words, translationRequests, topicTranslationCache, languages, wordContext)
├── repositories/
│   ├── user.repository.ts                # ✅ implemented
│   ├── word.repository.ts                # ✅ implemented (+ updateContent for partial regen)
│   ├── topic.repository.ts               # ✅ implemented
│   ├── language.repository.ts            # ✅ implemented (findByCode, create, getOrCreate, findAll)
│   └── word-context.repository.ts        # ✅ implemented (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
└── __tests__/
    ├── getDb.test.ts                     # 1 test
    ├── topic.repository.test.ts          # 4 tests
    ├── word.repository.test.ts           # 12 tests
    ├── language.repository.test.ts       # 7 tests (findByCode, create, getOrCreate, findAll)
    └── word-context.repository.test.ts   # 13 tests (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
```

## Migration

```
packages/adapters/db/drizzle/
├── 0000_purple_butterfly.sql             # Initial schema (users, userLanguageSettings, words, translationRequests)
├── 0001_parallel_thunderbolt.sql         # Adds languages, word_context, topic_translation_cache tables
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
