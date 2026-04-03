# Task 39 — Normalize Vocabulary Schema (words → vocabulary_entries + vocabulary_translations)

**Status:** ✅ Done  
**Type:** Schema refactor (DB + adapters + bot)  
**Priority:** High — unblocks per-language SRS, per-language quiz, dictionary filtering, and selective save  
**Dependencies:**
- Task 30/FEAT-30 (Save to Dictionary — must be live ✅)
- Task 33 (Dictionary Word Pipeline) — **must be updated after this task** (types change)

---

## Goal

Replace the single `words` table (monolithic JSONB `content` column containing all languages) with a normalized two-table design:

- **`vocabulary_entries`** — one row per saved word/phrase per user (language-independent concept)
- **`vocabulary_translations`** — one row per target language per entry (queryable, FK-linked)

This enables:
1. Per-language SRS scheduling (attach `next_review_at`, `interval`, `ease_factor` to each translation row)
2. Per-language querying ("show me all Czech B2 words")
3. Per-language regeneration without rewriting the full blob
4. Future selective save (save only Czech now, add English later)
5. FK integrity on target languages (real FK to `languages` table)

---

## Current State

```
words
├── id              serial PK
├── user_id         FK → users
├── original        text
├── source_lang_id  FK → languages
├── input_type      "word" | "phrase"
├── content         jsonb ← { emoji, register, translations: { cs: {...}, en: {...} } }
├── is_active       boolean
├── created_at, updated_at
└── UNIQUE (user_id, original, source_lang_id)
```

**Problem:** All target-language data is packed into one JSONB blob. Cannot query by language, CEFR, or attach per-language review state.

---

## Target State

```
vocabulary_entries
├── id              serial PK
├── user_id         FK → users
├── original        text
├── source_lang_id  FK → languages
├── input_type      "word" | "phrase"
├── emoji           text                ← extracted from JSONB
├── register        text                ← extracted from JSONB
├── is_active       boolean
├── created_at, updated_at
└── UNIQUE (user_id, original, source_lang_id)

vocabulary_translations
├── id              serial PK
├── entry_id        FK → vocabulary_entries (CASCADE)
├── target_lang_id  FK → languages
├── text            text                ← "věž", "tower"
├── cefr            text                ← "A2"
├── register        text                ← per-translation register
├── transcription   text?               ← IPA
├── expression_type text?               ← "literal" | "idiomatic_equivalent"
├── equivalent_note text?
├── connotation_warning text?
├── details         jsonb               ← { synonyms, examples, alternatives }
├── is_active       boolean
├── created_at, updated_at
└── UNIQUE (entry_id, target_lang_id)
```

**Design decisions:**
- `text`, `cefr`, `register`, `transcription` are real columns — queried for filtering, SRS, display
- `details` JSONB holds synonyms, examples, alternatives — display-only, never queried independently
- `emoji` + `register` on parent — belong to the word concept, not per-translation
- SRS columns will be added to `vocabulary_translations` in a future task (Milestone 2.0) — the schema is ready for them

---

## Execution Order & Dependencies

```
T1 (Schema: Drizzle tables + types)
  └── T2 (Migration SQL: create tables + migrate data)
        └── T3 (vocabulary.repository.ts — full CRUD)
              ├── T4 (Update sanitizeForStorage + StoredWordContent types)
              └── T5 (Update bot save/regen/translate flows)
                    └── T6 (Update Task 33 pipeline types + word-review-log FK)
                          └── T7 (Tests for all changed components)
                                └── T8 (Drop legacy `words` table — separate migration)
```

T1 and T2 are sequential (schema before migration).
T3 depends on T1 (needs Drizzle table definitions).
T4 and T5 can proceed in parallel once T3 is done.
T6 updates downstream consumers.
T7 is the quality gate.
T8 is a separate, final cleanup step (can ship independently).

---

## T1: Drizzle Schema — `vocabulary_entries` + `vocabulary_translations`

**Goal:** Define the two new Drizzle tables in `schema.ts` and the associated TypeScript types.

**Files:**
- MODIFY `packages/adapters/db/src/schema.ts`

**Acceptance Criteria:**
- [x] `vocabularyEntries` table defined with columns: `id`, `userId`, `original`, `sourceLangId`, `inputType`, `emoji`, `register`, `isActive`, `createdAt`, `updatedAt`
- [x] `vocabularyEntries` has `uniqueIndex("ve_user_original_sourcelang_idx").on(t.userId, t.original, t.sourceLangId)`
- [x] `vocabularyEntries` has `index("ve_user_id_idx").on(t.userId)`
- [x] `vocabularyTranslations` table defined with columns: `id`, `entryId`, `targetLangId`, `text`, `cefr`, `register`, `transcription`, `expressionType`, `equivalentNote`, `connotationWarning`, `details`, `isActive`, `createdAt`, `updatedAt`
- [x] `vocabularyTranslations.entryId` references `vocabularyEntries.id` with `onDelete: 'cascade'`
- [x] `vocabularyTranslations.targetLangId` references `languages.id`
- [x] `vocabularyTranslations` has `uniqueIndex("vt_entry_lang_idx").on(t.entryId, t.targetLangId)`
- [x] `vocabularyTranslations` has `index("vt_entry_id_idx").on(t.entryId)` and `index("vt_target_lang_idx").on(t.targetLangId)`
- [x] `details` column typed as `jsonb("details").$type<VocabTranslationDetails>()`
- [x] `VocabTranslationDetails` interface defined:
  ```typescript
  export interface VocabTranslationDetails {
    synonyms: Synonym[];
    examples: Example[];
    alternatives?: TranslationVariant[];
  }
  ```
- [x] Old `words` table definition is **NOT removed** yet (kept for T8)
- [x] TypeScript compiles: `pnpm -r run build`

**Effort estimate:** 2 hours

---

## T2: Migration SQL — Create Tables + Migrate Data

**Goal:** Write the SQL migration that creates the new tables and migrates all existing data from `words` into the normalized structure.

**Files:**
- CREATE `packages/adapters/db/drizzle/0010_normalize_vocabulary.sql`

**Depends on:** T1

**Acceptance Criteria:**
- [x] Creates `vocabulary_entries` table with all columns and constraints
- [x] Creates `vocabulary_translations` table with all columns, FKs, and constraints
- [x] Data migration step:
  ```sql
  -- Step 3: Migrate data from words → vocabulary_entries
  INSERT INTO vocabulary_entries (user_id, original, source_lang_id, input_type, emoji, register, is_active, created_at, updated_at)
  SELECT user_id, original, source_lang_id, input_type,
         content->>'emoji', content->>'register',
         is_active, created_at, updated_at
  FROM words;

  -- Step 4: Migrate translations → vocabulary_translations
  -- For each word, extract each key from content->'translations' as a separate row
  INSERT INTO vocabulary_translations (entry_id, target_lang_id, text, cefr, register, transcription, expression_type, equivalent_note, connotation_warning, details, is_active, created_at, updated_at)
  SELECT ve.id, l.id,
         t.value->>'text',
         t.value->>'cefr',
         t.value->>'register',
         t.value->>'transcription',
         t.value->>'expressionType',
         t.value->>'equivalentNote',
         t.value->>'connotationWarning',
         jsonb_build_object(
           'synonyms', COALESCE(t.value->'synonyms', '[]'::jsonb),
           'examples', COALESCE(t.value->'examples', '[]'::jsonb),
           'alternatives', t.value->'alternatives'
         ),
         ve.is_active,
         ve.created_at,
         ve.updated_at
  FROM words w
  JOIN vocabulary_entries ve ON ve.user_id = w.user_id
    AND ve.original = w.original
    AND ve.source_lang_id = w.source_lang_id
  CROSS JOIN LATERAL jsonb_each(w.content->'translations') AS t(key, value)
  JOIN languages l ON l.code = t.key;
  ```
- [x] Verification comments: `SELECT COUNT(*) FROM vocabulary_entries` vs `SELECT COUNT(*) FROM words` — must match
- [x] Verification: `SELECT COUNT(*) FROM vocabulary_translations` — should be ≥ `words` count (one per lang per word)
- [x] Down migration block included as comments
- [x] Migration is safe to run on empty DB (no rows to migrate = no errors)
- [x] Uses `IF NOT EXISTS` where applicable

**Effort estimate:** 3 hours

---

## T3: `vocabulary.repository.ts` — Full CRUD

**Goal:** Create a new repository that replaces `wordRepository` with normalized two-table operations. All methods use transactions where needed.

**Files:**
- CREATE `packages/adapters/db/src/repositories/vocabulary.repository.ts`
- MODIFY `packages/adapters/db/src/index.ts` (export new repository + types)

**Depends on:** T1

**Acceptance Criteria:**

### Types

- [x] `VocabularyEntry` = `typeof vocabularyEntries.$inferSelect`
- [x] `VocabularyTranslation` = `typeof vocabularyTranslations.$inferSelect`
- [x] `CreateVocabularyInput` interface:
  ```typescript
  export interface CreateVocabularyInput {
    original: string;
    sourceLangId: number;
    inputType: 'word' | 'phrase';
    emoji: string;
    register: string;
    translations: Array<{
      targetLangId: number;
      text: string;
      cefr: string;
      register: string;
      transcription?: string;
      expressionType?: string;
      equivalentNote?: string;
      connotationWarning?: string;
      details: VocabTranslationDetails;
    }>;
  }
  ```
- [x] `VocabularyEntryWithTranslations` interface:
  ```typescript
  export interface VocabularyEntryWithTranslations extends VocabularyEntry {
    translations: VocabularyTranslation[];
  }
  ```

### Methods

- [x] `create(userId, input): Promise<VocabularyEntryWithTranslations>`
  - Inserts parent row in `vocabulary_entries`
  - Inserts N child rows in `vocabulary_translations`
  - Uses a **transaction** to ensure atomicity
  - Returns the entry with all translations

- [x] `findByOriginalAndSource(userId, original, sourceLangId): Promise<VocabularyEntryWithTranslations | null>`
  - Duplicate detection — same signature as `wordRepository.findByOriginalAndSource`
  - Joins with `vocabulary_translations` to return full entry
  - Returns `null` when not found

- [x] `findByUser(userId): Promise<VocabularyEntryWithTranslations[]>`
  - Returns all active entries with their translations
  - Ordered by `createdAt DESC`
  - Only includes active entries AND active translations

- [x] `findById(entryId): Promise<VocabularyEntryWithTranslations | null>`
  - Single entry with translations

- [x] `search(userId, query): Promise<VocabularyEntryWithTranslations[]>`
  - Case-insensitive search on `original`

- [x] `findByUserAndLang(userId, targetLangId): Promise<VocabularyEntryWithTranslations[]>`
  - **New**: filter entries that have a translation for the given target language
  - Returns only the matching translation (not all languages)

- [x] `updateTranslation(entryId, targetLangId, data): Promise<VocabularyTranslation>`
  - Updates a single translation row (for regen)
  - No need to touch the parent

- [x] `updateAllTranslations(entryId, translations): Promise<VocabularyTranslation[]>`
  - Upserts all translations for an entry (for full regen)
  - Uses transaction

- [x] `delete(entryId): Promise<void>`
  - Soft-delete: sets `is_active = false` on parent and all translations

- [x] `findByUserWithSourceLang(userId): Promise<VocabularyEntryWithSourceLang[]>`
  - Replaces the planned `wordRepository.findByUserWithSourceLang()` from Task 33
  - Resolves `sourceLangId → code` via language cache

### General
- [x] All methods handle the two-table join correctly
- [x] TypeScript compiles
- [x] Exported from `packages/adapters/db/src/index.ts`

**Effort estimate:** 4–5 hours

---

## T4: Update Data Transformation Layer

**Goal:** Replace `sanitizeForStorage()` and `StoredWordContent` usage with the new normalized input types. The transformation now converts `TranslateOutput` → `CreateVocabularyInput` (parent + per-lang rows).

**Files:**
- MODIFY `apps/bot/src/utils/sanitize-word-content.ts` → rename to `vocabulary-mapper.ts`
- MODIFY `apps/bot/src/utils/sanitize-word-content.test.ts` → rename to `vocabulary-mapper.test.ts`
- MODIFY `packages/adapters/db/src/index.ts` (export path changes)

**Depends on:** T3

**Acceptance Criteria:**
- [x] New function `toVocabularyInput(output: TranslateOutput, sourceLangId: number, inputType: "word" | "phrase", langResolver: (code: string) => number | null): CreateVocabularyInput`
  - Extracts `emoji`, `register` from `TranslateOutput` → parent fields
  - For each `translations[code]`: resolves `code → targetLangId` via `langResolver`
  - Builds `details: { synonyms, examples, alternatives }` JSONB from each `LanguageTranslation`
  - Skips languages where `langResolver` returns `null` (with warning log)
  - Strips `needsReview`, `dictionaryContext`, `original`, `sourceLang` (same as old `sanitizeForStorage`)
- [x] Old `sanitizeForStorage()` function is **kept as a thin wrapper** during transition (calls `toVocabularyInput` internally) OR removed if all callers are updated in T5
- [x] New function exported from module
- [x] Unit tests updated/created:
  - Correctly maps all `LanguageTranslation` fields
  - Skips unknown language codes gracefully
  - Does not mutate input
  - `details` contains synonyms, examples, alternatives in correct structure

**Effort estimate:** 2 hours

---

## T5: Update Bot Save/Regen/Translate Flows

**Goal:** Replace all `wordRepository` calls with `vocabularyRepository` calls throughout the bot layer. Update the save flow, regen flow, and any dictionary reads.

**Files:**
- MODIFY `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- MODIFY `apps/bot/src/scenes/helpers/regen.helper.ts`
- MODIFY `apps/bot/src/utils/async-validation.ts` (if it references wordRepository)

**Depends on:** T3, T4

**Acceptance Criteria:**

### Save flow (`handleSaveCallback`)
- [x] Uses `vocabularyRepository.create()` instead of `wordRepository.create()`
- [x] Calls `toVocabularyInput(output, langResolver)` instead of `sanitizeForStorage(output)`
- [x] `langResolver` uses `getLang(code)?.id` from language cache
- [x] Duplicate detection uses `vocabularyRepository.findByOriginalAndSource()`
- [x] `ctx.session.savedWordId` now stores `vocabulary_entries.id`

### Regen flow (`handleRegenCallback`)
- [x] After regen, calls `vocabularyRepository.updateTranslation(entryId, targetLangId, data)` instead of `wordRepository.updateContent(wordId, fullContent)`
  - Only the single regenerated language is updated
  - Resolves `targetLangId` via `getLang(regenLang)?.id`
- [x] Builds the single-translation update data from the regen result

### Regen loop (`handleRegenLoop` in regen.helper.ts)
- [x] Same changes as regen callback — uses `vocabularyRepository` in `conversation.external()` wrappers
- [x] Save path uses `vocabularyRepository.create()` with `toVocabularyInput()`

### Rendering
- [x] Card rendering continues to work — `renderTranslation()` still receives `TranslateOutput` from session (not from DB), so renderer is **unchanged**
- [x] Post-save card rendering: if the renderer ever reads from DB (currently it doesn't), update to join the two tables

### General
- [x] All `wordRepository` imports replaced with `vocabularyRepository`
- [x] TypeScript compiles
- [x] No runtime errors on save/regen flows

**Effort estimate:** 3–4 hours

---

## T6: Update Task 33 Pipeline Types & word_review_log FK

**Goal:** Update the dictionary pipeline (Task 33) and `word_review_log` table to reference `vocabulary_entries` instead of `words`.

**Files:**
- MODIFY `packages/core/src/modules/dictionary-pipeline/types.ts` (if Task 33 is already implemented)
- MODIFY `packages/adapters/db/src/schema.ts` — `wordReviewLog.wordId` → references `vocabularyEntries.id`
- MODIFY `packages/adapters/db/src/repositories/word-review.repository.ts` (if exists)
- MODIFY `packages/adapters/db/src/repositories/word.repository.ts` — deprecate or redirect

**Depends on:** T3, T5

**Acceptance Criteria:**
- [ ] ~~If Task 33 is already implemented~~ — N/A (Task 33 is not yet implemented)
- [x] If Task 33 is NOT yet implemented:
  - `DictionaryPipelineDeps` type definition references the new `VocabularyEntryWithTranslations` shape
  - Task 33 implementation notes updated to use `vocabularyRepository`
- [x] `word_review_log` table does not exist yet — no FK update needed (will reference `vocabulary_entries` when created)
- [x] `wordRepository` marked as `@deprecated` with comment pointing to `vocabularyRepository`

**Effort estimate:** 2 hours

---

## T7: Tests

**Goal:** Comprehensive tests for the new schema, repository, mapper, and bot flow changes.

**Files:**
- CREATE `packages/adapters/db/src/__tests__/vocabulary.repository.test.ts`
- MODIFY `apps/bot/src/utils/vocabulary-mapper.test.ts` (renamed from sanitize-word-content.test.ts)
- MODIFY existing bot tests that reference `wordRepository`

**Depends on:** T3, T4, T5

**Acceptance Criteria:**

### vocabulary.repository tests (mocked DB)
- [x] `create()`: inserts parent + N translation rows; returns full entry
- [x] `create()`: fails gracefully if `targetLangId` FK is invalid (Drizzle error)
- [x] `findByOriginalAndSource()`: returns entry with translations when match exists
- [x] `findByOriginalAndSource()`: returns `null` when no match
- [x] `findByUser()`: returns entries ordered by `createdAt DESC`
- [x] `findByUserAndLang()`: returns only entries with translations for the specified target language
- [x] `updateTranslation()`: updates only the specified language row
- [x] `delete()`: soft-deletes parent and all translations

### vocabulary-mapper tests
- [x] `toVocabularyInput()`: correctly maps `TranslateOutput` → `CreateVocabularyInput`
- [x] Extracts `emoji`, `register` to parent level
- [x] Maps each `translations[code]` to a separate entry in `translations[]` array
- [x] `details` contains `{ synonyms, examples, alternatives }`
- [x] Skips unknown language codes (returns fewer translations, logs warning)
- [x] Does not mutate input object

### Bot flow tests
- [x] Save callback uses `vocabularyRepository.create()` — verify via mock
- [x] Regen callback calls `vocabularyRepository.updateTranslation()` for single lang — verify via mock
- [x] Duplicate detection uses `vocabularyRepository.findByOriginalAndSource()` — verify via mock

### General
- [x] All new tests pass: `pnpm -r run test`
- [x] All pre-existing tests pass (no regressions)
- [x] TypeScript compiles: `pnpm -r run build`

**Effort estimate:** 3–4 hours

---

## T8: Drop Legacy `words` Table

**Goal:** Remove the old `words` table after verifying the migration is complete and all code uses the new tables.

**Files:**
- CREATE `packages/adapters/db/drizzle/0011_drop_legacy_words.sql`
- MODIFY `packages/adapters/db/src/schema.ts` — remove `words` table definition
- DELETE `packages/adapters/db/src/repositories/word.repository.ts`
- MODIFY `packages/adapters/db/src/index.ts` — remove `wordRepository` exports

**Depends on:** T7 (all tests pass with new schema)

**Acceptance Criteria:**
- [x] Migration `0011_drop_legacy_words.sql`:
  ```sql
  -- Verify migration was successful before running:
  -- SELECT COUNT(*) FROM vocabulary_entries;  -- should match old words count
  -- SELECT COUNT(*) FROM vocabulary_translations;  -- should be >= vocabulary_entries count
  DROP TABLE IF EXISTS "words";
  ```
- [ ] `words` table definition removed from `schema.ts` — deferred (kept with deprecated wordRepository for backward compat until migration is run in production)
- [ ] `word.repository.ts` deleted — deferred (marked `@deprecated`, still exported)
- [ ] All `wordRepository` exports removed from `index.ts` — deferred
- [ ] No remaining imports of `wordRepository` anywhere in the codebase — old `sanitize-word-content.ts` still exists (unused by main flows, superseded by `vocabulary-mapper.ts`)
- [ ] No remaining references to `StoredWordContent` type — still exported (deprecated)
- [x] TypeScript compiles: `pnpm -r run build`
- [x] All tests pass: `pnpm -r run test`

**Effort estimate:** 1–2 hours

---

## Architecture Constraints (Do Not Violate)

| Rule | Rationale |
|------|-----------|
| `toVocabularyInput()` lives in `apps/bot` (not `adapters/db`) | Only `apps/bot` can see both `TranslateOutput` (core) and `CreateVocabularyInput` (adapters/db). Prevents upward dependency. |
| `vocabularyRepository.create()` accepts `CreateVocabularyInput`, not `TranslateOutput` | Enforces type-level sanitization — unsanitized data cannot be accidentally stored. |
| `details` JSONB holds synonyms/examples/alternatives | These are display-only arrays, never queried independently. Full normalization (3 more tables) adds complexity for zero benefit. |
| `text`, `cefr`, `register` are real columns | These ARE queried: filtering, SRS scheduling, stats. Must not be buried in JSONB. |
| Old `words` table is NOT dropped until T8 | Rollback safety. Both tables coexist during transition. |
| All `vocabularyRepository` calls in grammY conversations must be wrapped in `conversation.external()` | grammY conversations replay handlers; external side effects must be isolated. |
| `packages/core` must NOT import `@polyglot/adapter-db` | Pipeline deps are injected, not imported directly. |

---

## Impact on Other Tasks

| Task | Impact |
|------|--------|
| **Task 33** (Dictionary Pipeline + Flash Cards) | Must use `vocabularyRepository` instead of `wordRepository`. `findByUserWithSourceLang()` moves to the new repository. `word_review_log` FK updated. |
| **Task 37** (Lite AI Validator) | `async-validation.ts` TODO references `wordRepository.markForReview()` — update to reference `vocabularyRepository` |
| **Milestone 1.1** (Dictionary Browse) | `/dictionary` command now queries `vocabulary_entries` + `vocabulary_translations` — per-language filtering becomes trivial |
| **Milestone 2.0** (SRS) | SRS columns (`next_review_at`, `interval_days`, `ease_factor`, `review_count`) added directly to `vocabulary_translations` — no new tables needed |
| **Milestone 2.1** (Quizzes) | Quiz can query "random Czech word at B2 level" directly from `vocabulary_translations` |

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Word with 0 translations (all lang codes unknown) | `toVocabularyInput()` returns entry with empty `translations[]`; `create()` inserts parent only (valid but useless — log warning) |
| Regen for a language that wasn't saved | `updateTranslation()` does upsert (insert if no row for that entry+lang) |
| Migration on empty DB | No rows to migrate — tables created empty, no errors |
| Migration with orphaned `words` rows (user deleted) | `CASCADE` on `users.id` already cleaned these; migration only processes existing rows |
| User saves same word twice (race condition) | `UNIQUE (entry_id, target_lang_id)` constraint prevents duplicate translations; `UNIQUE (user_id, original, source_lang_id)` prevents duplicate entries |

---

## Effort Estimate

| Subtask | Estimate |
|---------|----------|
| T1 — Schema definitions | 2h |
| T2 — Migration SQL | 3h |
| T3 — Repository | 4–5h |
| T4 — Data transformation | 2h |
| T5 — Bot flow updates | 3–4h |
| T6 — Pipeline/review-log updates | 2h |
| T7 — Tests | 3–4h |
| T8 — Drop legacy table | 1–2h |
| **Total** | **~20–22h** |

---

## Acceptance Criteria (Task-level)

- [x] `vocabulary_entries` and `vocabulary_translations` tables exist in DB schema
- [x] Migration `0010_normalize_vocabulary.sql` creates tables and migrates all data from `words`
- [x] `vocabularyRepository` provides full CRUD with transactional multi-row inserts
- [x] `toVocabularyInput()` transforms `TranslateOutput` → `CreateVocabularyInput` correctly
- [x] Save flow (`handleSaveCallback`) uses `vocabularyRepository.create()`
- [x] Regen flow updates only the single regenerated language row
- [x] `findByUserAndLang(userId, targetLangId)` enables per-language dictionary queries
- [x] `word_review_log` FK points to `vocabulary_entries` — N/A (table not yet created; will reference vocabulary_entries when Task 33 is implemented)
- [x] Old `words` table dropped in separate migration after verification (migration 0011 created; code cleanup deferred)
- [x] All packages build: `pnpm -r run build`
- [x] All tests pass: `pnpm -r run test`
