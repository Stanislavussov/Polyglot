---
name: db
description: Database adapter using Drizzle ORM and PostgreSQL. Manages schema, migrations, repositories (User, Word, Vocabulary, Topic, Language, WordContext, WordReview), and singleton connection. Use when implementing or modifying database operations, schema changes, or repository methods.
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
- `schema.ts` — tables: `users`, `userLanguageSettings`, `words` (deprecated), `vocabularyEntries`, `vocabularyTranslations`, `wordReviewLog`, `translationRequests`, `translationRequestTargetLangs`, `topicTranslationCache`, `languages`, `wordContext`, `userTranslationTemplates`
- `index.ts` — singleton `getDb()`, `closeDb()`, re-exports all repositories (incl. `vocabularyRepository`, `translationRequestRepository`, `wordReviewRepository`), types, `createContextLookup`, and language cache functions (`loadLanguageCache`, `getLangDisplay`, `getSupportedLangs`, etc.)
- `context-lookup.ts` — `createContextLookup()` factory: wraps `wordContextRepository.findByWordAndLangCode()` + transforms DB rows to `DictionaryContext`. Fail-open (catches errors, returns `undefined`). Used by context-enrichment layer in core.
- `repositories/user.repository.ts` — findByTelegramId, create, updateSettings, getSettings, updateOnboardingStep, markOnboarded
- `repositories/vocabulary.repository.ts` — **Task 39**: normalized vocabulary CRUD. create (transactional parent+children), findByOriginalAndSource, findByUser, findById, search, findByUserAndLang, updateTranslation (upsert), updateAllTranslations, delete (soft), findByUserWithSourceLang. Exports VocabularyEntry, VocabularyTranslation, VocabTranslationDetails, VocabularyEntryWithTranslations, VocabularyEntryWithSourceLang, CreateVocabularyInput, UpdateTranslationData types.
- `repositories/word.repository.ts` — **@deprecated** (use vocabularyRepository). create (CreateWordInput), findByOriginalAndSource, findByUser, findById, search, delete (soft), updateContent (StoredWordContent typed). Exports StoredWordContent, StoredLanguageTranslation, CreateWordInput types.
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
  // Does NOT overwrite lastSourceLang unless explicitly provided in settings
getSettings(userId: number): Promise<UserLanguageSettings | null>;
updateActiveMode(userId: number, mode: string): Promise<UserLanguageSettings | null>;
updateLastSourceLang(userId: number, lang: string | null): Promise<void>;
  // Updates only lastSourceLang + updatedAt. Fire-and-forget friendly. Pass null to clear.
updateOnboardingStep(userId: number, step: number): Promise<User>;
markOnboarded(userId: number): Promise<User>;
  // Sets onboardingStep to 3 (BRD §5 — 3-step onboarding)
```

### VocabularyRepository (Task 39 — replaces WordRepository)

```typescript
create(userId: number, input: CreateVocabularyInput): Promise<VocabularyEntryWithTranslations>;
  // Transactional: inserts parent in vocabulary_entries + N children in vocabulary_translations
findByOriginalAndSource(userId: number, original: string, sourceLangId: number): Promise<VocabularyEntryWithTranslations | null>;
  // Duplicate detection — returns full entry with translations
findByUser(userId: number): Promise<VocabularyEntryWithTranslations[]>;
  // Active entries with active translations, ordered by createdAt DESC
findById(entryId: number): Promise<VocabularyEntryWithTranslations | null>;
search(userId: number, query: string): Promise<VocabularyEntryWithTranslations[]>;
  // Case-insensitive search on original
findByUserAndLang(userId: number, targetLangId: number): Promise<VocabularyEntryWithTranslations[]>;
  // Filter entries that have a translation for the given target language
updateTranslation(entryId: number, targetLangId: number, data: UpdateTranslationData): Promise<VocabularyTranslation>;
  // Upserts a single translation row (for per-language regen)
updateAllTranslations(entryId: number, translations: Array<{ targetLangId: number } & UpdateTranslationData>): Promise<VocabularyTranslation[]>;
  // Upserts all translations for an entry (transactional)
delete(entryId: number): Promise<void>;
  // Soft-delete: sets is_active = false on parent and all translations
findByUserWithSourceLang(userId: number): Promise<VocabularyEntryWithSourceLang[]>;
  // Returns entries with sourceLangCode resolved via language cache
```

### WordRepository (@deprecated — use VocabularyRepository)

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

### WordReviewRepository

```typescript
logReview(userId: number, entryId: number, sessionType: string): Promise<void>;
  // Inserts a row into word_review_log. sessionType: 'flashcard' | 'notification' | 'quiz' | 'srs'
getReviewCounts(userId: number): Promise<Map<number, number>>;
  // Returns Map<entryId, reviewCount>. Entries with no reviews are NOT in the map (treat as 0).
getReviewsForWord(entryId: number, limit?: number): Promise<WordReview[]>;
  // Returns reviews in descending order (most recent first). For SRS scheduling.
getReviewsBySessionType(userId: number, sessionType: string, limit?: number): Promise<WordReview[]>;
  // Returns reviews for a user filtered by session type, descending order.
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
- `userLanguageSettings` — 1-to-1 with users, interfaceLang, nativeLang, learningLangs[], timezone, activeMode (default "translate"), lastSourceLang (nullable text — last explicitly selected source lang, survives restarts), isActive, updatedAt
- `vocabularyEntries` — **(Task 39)** userId (FK → users, CASCADE), original, sourceLangId (FK → languages.id), inputType ('word'|'phrase'), emoji, register, isActive, createdAt, updatedAt; unique index on (userId, original, sourceLangId). Replaces the parent data from old `words` table.
- `vocabularyTranslations` — **(Task 39)** entryId (FK → vocabularyEntries, CASCADE), targetLangId (FK → languages.id), text, cefr, register, transcription, expressionType, equivalentNote, connotationWarning, details (JSONB typed as VocabTranslationDetails), isActive, createdAt, updatedAt; unique index on (entryId, targetLangId). One row per target language per entry.
- `words` — **@deprecated** (superseded by vocabularyEntries + vocabularyTranslations). userId, original, sourceLangId (FK → languages.id), inputType, content (JSONB), isActive, createdAt, updatedAt; unique index on (userId, original, sourceLangId). Migration 0011 drops this table.
- `translationRequests` — userId, original, sourceLangId (FK → languages.id, nullable), createdAt (for rate limiting)
- `translationRequestTargetLangs` — requestId (FK → translationRequests.id), languageId (FK → languages.id); unique index on (requestId, languageId)
- `topicTranslationCache` — topicId, original, sourceLang, targetLang, content (JSONB), isValid, invalidReason, createdAt, updatedAt; unique index on (topicId, original, sourceLang, targetLang)
- `languages` — id, code (unique), name, createdAt; unique index on code. Normalized lookup for language codes (e.g. "ru" → "Russian")
- `wordReviewLog` — id, entryId (FK → vocabularyEntries.id, CASCADE), userId (FK → users.id, CASCADE), sessionType (text: 'flashcard'|'notification'|'quiz'|'srs'), reviewedAt (timestamp, default now); indexes on (entryId) and (userId, reviewedAt). Tracks flash card, notification, quiz reviews for 'least_reviewed' strategy and future SRS.
- `wordContext` — id, word, languageId (FK → languages.id), pos, formTags (text[]), glosses (text[]), createdAt; indexes on (word, languageId) and (languageId). Offline dictionary data from Wiktionary JSONL
- `userTranslationTemplates` — id, userId (FK → users.id, unique, cascade), name (text, default 'Custom'), transcription (bool, default true), synonyms (bool, default true), examples (bool, default true), alternatives (bool, default true), equivalentNote (bool, default true), connotationWarning (bool, default true), createdAt, updatedAt; unique index on userId. 1-to-1 with users — customizable output template. Individual columns (not JSONB) for type safety and schema evolution.

## Vocabulary Translation Details (vocabulary_translations.details — typed as VocabTranslationDetails)

```typescript
interface VocabTranslationDetails {
  synonyms: Synonym[];
  examples: Example[];
  alternatives?: TranslationVariant[];
}
```

## Content JSONB Structure (words.content — @deprecated, typed as StoredWordContent)

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

// WordReview types (Task 33 — review tracking for flashcards, notifications, quizzes)
type WordReview = { id: number; entryId: number; userId: number; sessionType: string; reviewedAt: Date };

// Vocabulary types (Task 39 — normalized schema, replaces StoredWordContent)
// See vocabulary.repository.ts for full interface definitions
type VocabularyEntry = typeof vocabularyEntries.$inferSelect;
type VocabularyTranslation = typeof vocabularyTranslations.$inferSelect;
type VocabTranslationDetails = { synonyms: Synonym[]; examples: Example[]; alternatives?: TranslationVariant[] };
type VocabularyEntryWithTranslations = VocabularyEntry & { translations: VocabularyTranslation[] };
type VocabularyEntryWithSourceLang = VocabularyEntryWithTranslations & { sourceLangCode: string };
type CreateVocabularyInput = { original: string; sourceLangId: number; inputType: 'word' | 'phrase'; emoji: string; register: string; translations: Array<{ targetLangId: number; text: string; cefr: string; register: string; transcription?: string; expressionType?: string; equivalentNote?: string; connotationWarning?: string; details: VocabTranslationDetails }> };
type UpdateTranslationData = { text?: string; cefr?: string; register?: string; transcription?: string; expressionType?: string; equivalentNote?: string; connotationWarning?: string; details?: VocabTranslationDetails };

// StoredWordContent types (@deprecated — use Vocabulary types above)
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
│   ├── vocabulary.repository.ts          # ✅ implemented (Task 39 — normalized CRUD: create, find*, update*, delete, search)
│   ├── word.repository.ts                # ⚠️ @deprecated (use vocabulary.repository.ts — Task 39)
│   ├── topic.repository.ts               # ✅ implemented
│   ├── language.repository.ts            # ✅ implemented (findByCode, create, getOrCreate, findAll)
│   ├── translation-request.repository.ts  # ✅ implemented (logTranslationRequest, getUserRequestsInWindow, getRecentRequests)
│   ├── translation-template.repository.ts # ✅ implemented (getByUserId, upsert, deleteByUserId — Task 32)
│   ├── word-review.repository.ts         # ✅ implemented (logReview, getReviewCounts, getReviewsForWord, getReviewsBySessionType — Task 33)
│   └── word-context.repository.ts        # ✅ implemented (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
└── __tests__/
    ├── getDb.test.ts                     # 1 test
    ├── user.repository.test.ts           # 28 tests (findByTelegramId, create, updateSettings incl. max-4 guard + lastSourceLang protection, getSettings + lastSourceLang, updateActiveMode, updateLastSourceLang, updateOnboardingStep, markOnboarded)
    ├── vocabulary.repository.test.ts     # 25 tests (Task 39 — create, findByOriginalAndSource, findByUser, findById, search, findByUserAndLang, updateTranslation, updateAllTranslations, delete, findByUserWithSourceLang)
    ├── topic.repository.test.ts          # 4 tests
    ├── word.repository.test.ts           # 20 tests (@deprecated — create, findByOriginalAndSource, findByUser, findById, search, updateContent, delete)
    ├── language.repository.test.ts       # 7 tests (findByCode, create, getOrCreate, findAll)
    ├── word-context.repository.test.ts   # 13 tests (findByWordAndLang, findByWordAndLangCode, search, createBatch, countByLanguage, findById)
    ├── translation-request.repository.test.ts # 11 tests (logTranslationRequest, getUserRequestsInWindow, getRecentRequests)
    ├── translation-template.repository.test.ts # 12 tests (getByUserId, upsert, deleteByUserId, field normalization, validation — Task 32)
    ├── word-review.repository.test.ts    # 13 tests (logReview, getReviewCounts, getReviewsForWord, getReviewsBySessionType — Task 33)
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
├── 0009_persist_last_source_lang.sql     # Adds last_source_lang column to user_language_settings (Task 36)
├── 0010_normalize_vocabulary.sql         # Creates vocabulary_entries + vocabulary_translations tables, migrates data from words (Task 39)
├── 0011_drop_legacy_words.sql            # Drops legacy words table after migration verification (Task 39)
├── 0012_word_review_log.sql             # Creates word_review_log table for flashcard/notification/quiz review tracking (Task 33)
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
