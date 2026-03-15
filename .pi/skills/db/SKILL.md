---
name: db
description: Database adapter using Drizzle ORM and PostgreSQL. Manages schema, migrations, repositories (User, Word, Topic), and singleton connection. Use when implementing or modifying database operations, schema changes, or repository methods.
---

# db Agent Skill

## Module Location

`packages/adapters/db/src/`

## Architecture Context

- **Layer:** Adapter (platform-dependent)
- **Dependencies:** None — leaf agent
- **Dependents:** `topics`, `notifications`, `bot` agents consume repositories

## Current State

Already implemented:
- `schema.ts` — tables: `users`, `userLanguageSettings`, `words`, `translationRequests`
- `index.ts` — singleton `getDb()`, `closeDb()`, re-exports
- `repositories/user.repository.ts` — findByTelegramId, create, updateSettings, getSettings, updateOnboardingStep, markOnboarded
- `repositories/word.repository.ts` — create, findByUser, findById, search, delete (soft)

Still needed:
- `repositories/topic.repository.ts` — topic translation caching (getCached, setCached, markInvalid)
- Topic cache table in schema (if needed)

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
delete(wordId: number): Promise<void>;  // soft delete
```

### TopicRepository (to be created)

```typescript
getCached(topicId: string, original: string, sourceLang: string, targetLang: string): Promise<TopicTranslation | null>;
setCached(data: NewTopicTranslation): Promise<TopicTranslation>;
markInvalid(id: number, reason: string): Promise<void>;
```

## Schema (current)

See `packages/adapters/db/src/schema.ts` for full Drizzle table definitions. Key tables:
- `users` — id, telegramId, username, onboardingStep, onboarded, isActive, createdAt
- `userLanguageSettings` — 1-to-1 with users, interfaceLang, nativeLang, learningLangs[], timezone
- `words` — userId, original, sourceLang, content (JSONB with translations per target lang)
- `translationRequests` — userId, original, sourceLang, targetLangs[], createdAt (for rate limiting)

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

## File Structure

```
packages/adapters/db/src/
├── index.ts                          # getDb(), closeDb(), re-exports
├── schema.ts                         # Drizzle table definitions
├── repositories/
│   ├── user.repository.ts            # ✅ implemented
│   ├── word.repository.ts            # ✅ implemented
│   └── topic.repository.ts           # ❌ to be created
└── __tests__/
    └── getDb.test.ts
```

## Reference

- DB schema spec: `docs/tech-reqs/05-db-schema.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Adapter contract: `docs/tech-reqs/04-adapter-contract.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (db section)
