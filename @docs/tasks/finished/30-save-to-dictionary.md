# Task 30: Save to Dictionary (FEAT-30)

**Status:** ✅ Done  
**Tech design:** `@docs/tech-reqs/30-save-to-dictionary.md`  
**Upstream task:** `@docs/tasks/27-input-type-detection-and-text-limits.md` (prerequisite — must be complete)

---

## Overview

Allows users to save AI translation results to their personal dictionary by tapping an inline Telegram button. The feature covers:

- DB schema improvements (FK for source language, input type column, dedup constraint)
- A safe save flow: duplicate detection, content sanitization, FK resolution
- Contextual keyboard labels ("Save word" vs "Save phrase")
- Post-save card state: regen-only keyboard + saved indicator
- Regen-after-save auto-updates the stored entry

Input types `word` and `phrase` get Save/Skip buttons; `sentence` does not (unchanged from Task 27).

---

## Execution Order & Dependencies

```
T1 (Migration SQL)
  └── T2 (Schema + StoredWordContent types)
        └── T3 (wordRepository: create/findByOriginalAndSource/updateContent)
              ├── T4 (i18n keys)  ← independent, can run in parallel with T1-T3
              ├── T5 (sanitizeForStorage utility + SessionData.savedWordId)
              └── T6 (Keyboard builder: buildTranslationKeyboard + buildPostSaveKeyboard)
                    ├── T7 (handleSaveCallback — main save flow)
                    └── T8 (handleRegenCallback + handleTranslateText session reset)
                          └── T9 (handleRegenLoop in regen.helper.ts)
                                └── T10 (Tests for all changed/new components)
```

T4 is independent and can be done in parallel with T1–T3.
T5 depends on T3 (needs `StoredWordContent` type).
T6 depends on T4 (needs new i18n keys for button labels).
T7, T8, T9 depend on T3, T5, T6.
T10 is the final quality gate.

---

## T1: Write DB Migration 0005

**Goal:** Create the SQL migration file that adds `source_lang_id` FK, `input_type` column, and the dedup unique index to the `words` table.

**Files:**
- CREATE `packages/adapters/db/drizzle/0005_words_dictionary_improvements.sql`

**Acceptance Criteria:**
- [x] File `0005_words_dictionary_improvements.sql` exists in `packages/adapters/db/drizzle/`
- [x] Step 1: `ALTER TABLE "words" ADD COLUMN IF NOT EXISTS "source_lang_id" INTEGER REFERENCES "languages"("id");` (nullable first)
- [x] Step 2: `ALTER TABLE "words" ADD COLUMN IF NOT EXISTS "input_type" TEXT NOT NULL DEFAULT 'word' CHECK (input_type IN ('word', 'phrase'));`
- [x] Step 3: Backfill `source_lang_id` from existing `source_lang` text by joining `languages.code`:
  ```sql
  UPDATE "words" w SET "source_lang_id" = l."id" FROM "languages" l
  WHERE w."source_lang" = l."code" AND w."source_lang" IS NOT NULL AND w."source_lang_id" IS NULL;
  ```
- [x] Step 4 comment: instructs operator to verify no NULL `source_lang_id` rows before Step 5
- [x] Step 5: `ALTER TABLE "words" ALTER COLUMN "source_lang_id" SET NOT NULL;`
- [x] Step 6: `CREATE UNIQUE INDEX IF NOT EXISTS "words_user_original_sourcelangid_idx" ON "words" ("user_id", "original", "source_lang_id");`
- [x] Step 7: `ALTER TABLE "words" ALTER COLUMN "source_lang" DROP NOT NULL;` (deprecate, not drop)
- [x] Down migration block included as comments (drop index, drop columns, restore NOT NULL on `source_lang`)
- [x] Migration is idempotent: uses `IF NOT EXISTS` where applicable
- [x] `source_lang` column is NOT dropped (retained for future migration 0006)

**Effort estimate:** 1–2 hours

---

## T2: Update Drizzle Schema + Define StoredWordContent Types

**Goal:** Update `schema.ts` to reflect the new `words` table shape after migration 0005, and define the `StoredWordContent` / `StoredLanguageTranslation` TypeScript types in the word repository file.

**Files:**
- MODIFY `packages/adapters/db/src/schema.ts`
- MODIFY `packages/adapters/db/src/repositories/word.repository.ts` (type definitions only in this task)
- MODIFY `packages/adapters/db/src/index.ts` (re-export new types)

**Depends on:** T1

**Acceptance Criteria:**
- [x] `words` Drizzle table in `schema.ts` includes:
  - `sourceLangId: integer("source_lang_id").references(() => languages.id).notNull()`
  - `sourceLang: text("source_lang")` — nullable (was `notNull()`, now without `.notNull()`)
  - `inputType: text("input_type").$type<'word' | 'phrase'>().default('word').notNull()`
  - `uniqueIndex("words_user_original_sourcelangid_idx").on(t.userId, t.original, t.sourceLangId)`
- [x] Existing `index("words_user_id_idx")` is preserved unchanged
- [x] `content` column retains `jsonb("content").notNull()` — type will be updated in T3
- [x] `StoredWordContent` interface defined in `word.repository.ts`:
  ```typescript
  export interface StoredWordContent {
    emoji: string;
    register: Register;
    translations: Record<string, StoredLanguageTranslation>;
  }
  ```
- [x] `StoredLanguageTranslation` interface defined in `word.repository.ts`:
  ```typescript
  export interface StoredLanguageTranslation {
    text: string;
    cefr: CefrLevel;
    transcription?: string;
    register: Register;
    synonyms: Synonym[];
    examples: Example[];
    alternatives?: TranslationVariant[];
    expressionType?: ExpressionType;
    equivalentNote?: string;
  }
  ```
  (Imports: `CefrLevel`, `Example`, `ExpressionType`, `Register`, `Synonym`, `TranslationVariant` from `@polyglot/core`)
- [x] `StoredWordContent` and `StoredLanguageTranslation` are exported from `packages/adapters/db/src/index.ts`
- [x] TypeScript compiles without errors (`pnpm -r run build`)

**Effort estimate:** 2 hours

---

## T3: Update wordRepository — create(), findByOriginalAndSource(), updateContent()

**Goal:** Update `wordRepository.create()` to accept the new `CreateWordInput` shape (with `sourceLangId` and `inputType`), add `findByOriginalAndSource()` for duplicate detection, tighten `updateContent()` to accept `StoredWordContent`, and wire `content` column to `StoredWordContent` type in the schema.

**Files:**
- MODIFY `packages/adapters/db/src/repositories/word.repository.ts`
- MODIFY `packages/adapters/db/src/schema.ts` — wire `content` to `StoredWordContent.$type<StoredWordContent>()`

**Depends on:** T2

**Acceptance Criteria:**
- [x] `CreateWordInput` interface exported from `word.repository.ts`:
  ```typescript
  export interface CreateWordInput {
    original: string;
    sourceLangId: number;
    inputType: 'word' | 'phrase';
    content: StoredWordContent;
  }
  ```
- [x] `wordRepository.create(userId: number, input: CreateWordInput): Promise<Word>` — no longer accepts `sourceLang` text or raw `TranslateOutput` as content; uses `sourceLangId` and `inputType`
- [x] Old `create()` signature (`Omit<NewWord, "userId">`) is REPLACED, not overloaded
- [x] `wordRepository.findByOriginalAndSource(userId: number, original: string, sourceLangId: number): Promise<Word | null>`:
  - Query: `WHERE user_id = $userId AND original = $original AND source_lang_id = $sourceLangId LIMIT 1`
  - Returns `null` when no entry found (not `undefined`)
  - Uses the unique index for efficient lookup
- [x] `wordRepository.updateContent(wordId: number, content: StoredWordContent): Promise<Word>` — parameter type updated from `Record<string, unknown>` to `StoredWordContent`
- [x] `words` schema `content` column typed: `jsonb("content").$type<StoredWordContent>().notNull()`
- [x] `findByUser`, `findById`, `search`, `delete` methods — NO CHANGES
- [x] `CreateWordInput` exported from `packages/adapters/db/src/index.ts`
- [x] TypeScript compiles without errors

**Effort estimate:** 2 hours

---

## T4: Add i18n Keys — saveWord and savePhrase

**Goal:** Add the `saveWord` and `savePhrase` translation keys to all three locale files and to the `TranslationKey` TypeScript union type.

**Files:**
- MODIFY `packages/core/src/modules/i18n/locales/en.json`
- MODIFY `packages/core/src/modules/i18n/locales/ru.json`
- MODIFY `packages/core/src/modules/i18n/locales/cs.json`
- MODIFY `packages/core/src/modules/i18n/types.ts`

**Depends on:** none (independent)

**Acceptance Criteria:**
- [x] `en.json` contains:
  ```json
  "saveWord": "💾 Save word",
  "savePhrase": "💾 Save phrase"
  ```
- [x] `ru.json` contains:
  ```json
  "saveWord": "💾 Сохранить слово",
  "savePhrase": "💾 Сохранить фразу"
  ```
- [x] `cs.json` contains:
  ```json
  "saveWord": "💾 Uložit slovo",
  "savePhrase": "💾 Uložit frázi"
  ```
- [x] `TranslationKey` union type in `types.ts` includes `'saveWord'` and `'savePhrase'`
- [x] `t('saveWord', 'en')` returns `"💾 Save word"` at runtime
- [x] `t('savePhrase', 'ru')` returns `"💾 Сохранить фразу"` at runtime
- [x] `t('saveWord', 'cs')` returns `"💾 Uložit slovo"` at runtime
- [x] TypeScript compiles — no missing key errors in `t()` call sites

**Effort estimate:** 1 hour

---

## T5: sanitizeForStorage() Utility + SessionData.savedWordId

**Goal:** Create the pure `sanitizeForStorage()` utility that strips internal pipeline metadata from `TranslateOutput` before persisting, and add `savedWordId` to `SessionData`.

**Files:**
- CREATE `apps/bot/src/utils/sanitize-word-content.ts`
- MODIFY `apps/bot/src/types.ts`

**Depends on:** T3 (needs `StoredWordContent` type from `@polyglot/adapter-db`)

**Acceptance Criteria:**
- [x] `sanitize-word-content.ts` exports:
  ```typescript
  export function sanitizeForStorage(output: TranslateOutput): StoredWordContent
  ```
- [x] Implementation extracts only `{ emoji, register, translations }` from `TranslateOutput`
- [x] The following fields are NOT included in the returned object:
  - `needsReview` (transient validation signal)
  - `dictionaryContext` (Wiktionary enrichment for AI prompt only)
  - `original` (stored as `words.original` column — not duplicated in JSONB)
  - `sourceLang` (stored as `words.sourceLangId` FK — not duplicated in JSONB)
- [x] Return type annotation is `StoredWordContent` (not inferred)
- [x] `SessionData` interface in `apps/bot/src/types.ts` includes:
  ```typescript
  /**
   * DB id of the word entry saved in this session.
   * Set after a successful tr:save — enables regen handler to call
   * updateContent() instead of silently ignoring the regen update.
   * Cleared when a new translation is started.
   */
  savedWordId?: number;
  ```
- [x] All other `SessionData` fields are unchanged
- [x] TypeScript compiles without errors

**Effort estimate:** 1 hour

---

## T6: Keyboard Builder Update — inputType Labels + buildPostSaveKeyboard

**Goal:** Update `buildTranslationKeyboard()` to accept an `inputType` parameter and use contextual Save button labels ("Save word" vs "Save phrase"), and add `buildPostSaveKeyboard()` for the post-save regen-only state.

**Files:**
- MODIFY `apps/bot/src/renderers/translation.renderer.ts`

**Depends on:** T4 (needs `saveWord` / `savePhrase` i18n keys)

**Acceptance Criteria:**
- [x] `buildTranslationKeyboard` signature updated:
  ```typescript
  export function buildTranslationKeyboard(
    langCodes: string[],
    inputType: 'word' | 'phrase',
    interfaceLang?: string,
  ): InlineKeyboard
  ```
  - When `inputType === 'word'`: Save button label is `t('saveWord', lang)` = "💾 Save word"
  - When `inputType === 'phrase'`: Save button label is `t('savePhrase', lang)` = "💾 Save phrase"
  - Save button callback data stays `"tr:save"` (unchanged)
  - Skip button (`t('no', lang)`, callback `"tr:skip"`) is still present
  - Regen buttons row structure is unchanged
- [x] `buildPostSaveKeyboard` new function exported:
  ```typescript
  export function buildPostSaveKeyboard(
    langCodes: string[],
    interfaceLang?: string,
  ): InlineKeyboard
  ```
  - Row 1: one regen button per lang — identical to `buildSentenceKeyboard`
  - No Row 2 (no Save/Skip)
  - Callback data format: `tr:regen:<code>` — identical to other regen buttons
- [x] All existing callers of `buildTranslationKeyboard` are updated to pass `inputType`
  - `translate-mode.helper.ts`: passes `classification.type as 'word' | 'phrase'`
  - `regen.helper.ts`: passes `ctx.session.lastInputType as 'word' | 'phrase'`
- [x] `buildSentenceKeyboard` — no changes
- [x] `renderTranslation`, `renderSentenceTranslation` — no changes
- [x] TypeScript compiles without errors

**Effort estimate:** 2 hours

---

## T7: Update handleSaveCallback() — Full FEAT-30 Save Flow

**Goal:** Replace the current simplistic `handleSaveCallback()` with the complete FEAT-30 save flow: FK resolution, duplicate detection, content sanitization, DB persist, session update, and in-place card edit to post-save state.

**Files:**
- MODIFY `apps/bot/src/scenes/helpers/translate-mode.helper.ts`

**Depends on:** T3 (wordRepository), T5 (sanitizeForStorage, savedWordId), T6 (buildPostSaveKeyboard)

**Acceptance Criteria:**
- [x] `handleSaveCallback()` reads `pendingTranslation` and `lastInputType` from session
- [x] If `pendingTranslation` is undefined: calls `answerCallbackQuery()` and returns early
- [x] **Step 2 — FK resolution:** calls `getLang(output.sourceLang)` from language cache
  - If `getLang` returns null: logs error, answers with `t('translationError', lang)` toast, returns
  - `sourceLangId = lang.id`
- [x] **Step 3 — Duplicate detection:** calls `wordRepository.findByOriginalAndSource(ctx.user.id, output.original, sourceLangId)`
  - If existing entry found: calls `answerCallbackQuery({ text: t('alreadySaved', lang), show_alert: true })` and returns — no new DB entry created
- [x] **Step 4 — Sanitize:** calls `sanitizeForStorage(output)` — strips `needsReview`, `dictionaryContext`, `original`, `sourceLang`
- [x] **Step 5 — Persist:** calls `wordRepository.create(ctx.user.id, { original: output.original, sourceLangId, inputType: inputType as 'word' | 'phrase', content })`
- [x] **Step 6 — Session update:**
  - `ctx.session.savedWordId = newEntry.id`
  - `ctx.session.pendingTranslation = undefined`
  - `ctx.session.pendingCardMsgId = undefined`
- [x] **Step 7 — Edit card in place:**
  - Card text: `renderTranslation(output, lang) + "\n\n" + t('savedToDict', lang)`
  - Keyboard: `buildPostSaveKeyboard(Object.keys(output.translations), lang)` — regen-only, no Save/Skip
  - Uses `ctx.editMessageText(savedCard, { reply_markup: keyboard, parse_mode: 'HTML' })`
- [x] **Step 8:** calls `answerCallbackQuery()` at end
- [x] Errors from `editMessageText` (e.g. message too old) are caught and logged — save still succeeds
- [x] The `sendSourceLangMenu()` call is REMOVED after save (UX change: post-save card is already interactive via regen buttons)

**Effort estimate:** 3 hours

---

## T8: Update handleRegenCallback() + handleTranslateText() — Post-Save Regen + Session Reset

**Goal:** Update `handleRegenCallback()` to auto-update the saved DB entry when `savedWordId` is set, and update `handleTranslateText()` to: (a) reset `savedWordId` on new translation, and (b) pass `inputType` to `buildTranslationKeyboard()`.

**Files:**
- MODIFY `apps/bot/src/scenes/helpers/translate-mode.helper.ts`

**Depends on:** T3 (wordRepository.updateContent), T5 (sanitizeForStorage, savedWordId), T6 (buildTranslationKeyboard with inputType)

**Acceptance Criteria — handleRegenCallback():**
- [x] After regenerating and updating `ctx.session.lastTranslation`:
  - Checks `ctx.session.savedWordId`
  - If set: calls `sanitizeForStorage(updated)` then `wordRepository.updateContent(savedWordId, sanitized)` — silently updates saved entry
  - DB update errors are caught and logged — regen still re-renders card
- [x] Card is re-rendered with:
  - If `savedWordId` is set (word is saved): uses `buildPostSaveKeyboard()` + appends `t('savedToDict', lang)` to card text
  - If `savedWordId` is not set (word not yet saved): uses `buildTranslationKeyboard(langCodes, inputType as 'word' | 'phrase', lang)` as before
- [x] `pendingTranslation` is NOT updated after regen when `savedWordId` is set (it was already cleared on save)
- [x] `savedWordId` remains set after regen — further regens continue updating the same entry

**Acceptance Criteria — handleTranslateText():**
- [x] Resets `ctx.session.savedWordId = undefined` at the start of every new translation
- [x] For word/phrase path: calls `buildTranslationKeyboard(langCodes, classification.type as 'word' | 'phrase', lang)` — passes `inputType` (was `buildTranslationKeyboard(langCodes, lang)`)
- [x] Sentence path is unchanged (no `buildTranslationKeyboard` call for sentences)
- [x] All other existing behavior unchanged

**Effort estimate:** 2 hours

---

## T9: Update handleRegenLoop() in regen.helper.ts — Save Flow Parity

**Goal:** Update the grammY conversation-based `handleRegenLoop()` in `regen.helper.ts` to use the same FEAT-30 save flow (dedup + sanitize + inputType) as `handleSaveCallback()`, and pass `inputType` to `buildTranslationKeyboard()`.

**Files:**
- MODIFY `apps/bot/src/scenes/helpers/regen.helper.ts`

**Depends on:** T3 (wordRepository.create/findByOriginalAndSource), T5 (sanitizeForStorage), T6 (buildTranslationKeyboard with inputType)

**Context:** `handleRegenLoop` is a grammY conversation-based handler invoked inside `conversation.waitForCallbackQuery`. All `wordRepository` calls must be wrapped in `conversation.external(async () => { ... })` as per grammY conventions (side-effect isolation).

**Acceptance Criteria — tr:save path in handleRegenLoop:**
- [x] Duplicate detection: wraps `wordRepository.findByOriginalAndSource(userId, current.original, sourceLangId)` in `conversation.external()`
  - Resolves `sourceLangId` via `getLang(current.sourceLang)?.id`
  - If duplicate found: calls `answerCallbackQuery({ text: alreadySavedMsg, show_alert: true })` and continues loop (does NOT return)
- [x] Content sanitization: calls `sanitizeForStorage(current)` before persisting
- [x] `wordRepository.create()` call uses new `CreateWordInput` shape: `{ original, sourceLangId, inputType: inputType ?? 'word', content: sanitized }`
- [x] After successful save: card shows `t('savedToDict', lang)` and keyboard switches to `buildPostSaveKeyboard(langCodes, lang)` (regen-only)
- [x] After successful save: `return` from the loop (existing behavior preserved)

**Acceptance Criteria — regen keyboard in handleRegenLoop:**
- [x] `buildKeyboard` selection: `isSentence ? buildSentenceKeyboard : (codes) => buildTranslationKeyboard(codes, inputType ?? 'word', lang)`
  - `inputType` param comes from function parameter `inputType?: InputType`
- [x] All regen re-renders use the updated `buildKeyboard` (passes `inputType`)

**Acceptance Criteria — general:**
- [x] `handleRegenLoop` function signature: `inputType?: InputType` parameter unchanged (already present)
- [x] `sanitizeForStorage` imported from `../../utils/sanitize-word-content.js`
- [x] `getLang` imported from `@polyglot/adapter-db` (already used elsewhere)
- [x] `buildPostSaveKeyboard` imported from renderer
- [x] TypeScript compiles without errors

**Effort estimate:** 2 hours

---

## T10: Tests

**Goal:** Write unit tests for all new/changed components: `sanitizeForStorage()`, updated `buildTranslationKeyboard()`, new `buildPostSaveKeyboard()`, and `wordRepository.findByOriginalAndSource()`.

**Files:**
- CREATE `apps/bot/src/utils/sanitize-word-content.test.ts`
- MODIFY `apps/bot/src/renderers/__tests__/translation.renderer.test.ts` (or create if not present)
- MODIFY `packages/adapters/db/src/__tests__/word.repository.test.ts` (or create if not present)

**Depends on:** T2, T3, T5, T6

**Acceptance Criteria — sanitizeForStorage tests:**
- [x] Strips `needsReview` field — not present in output
- [x] Strips `dictionaryContext` field — not present in output
- [x] Strips `original` field — not present in output
- [x] Strips `sourceLang` field — not present in output
- [x] Retains `emoji`, `register`, `translations` — present and equal to input values
- [x] `translations` nested structure is preserved unchanged (deep equality)
- [x] Does not mutate the input `TranslateOutput` object

**Acceptance Criteria — buildTranslationKeyboard tests:**
- [x] `buildTranslationKeyboard(['cs'], 'word', 'en')` — Save button text contains "Save word" (or configured i18n value)
- [x] `buildTranslationKeyboard(['cs'], 'phrase', 'en')` — Save button text contains "Save phrase"
- [x] Skip button still present in both cases
- [x] Regen button for 'cs' still present in both cases

**Acceptance Criteria — buildPostSaveKeyboard tests:**
- [x] Returns keyboard with regen button per language code
- [x] No Save/Skip buttons present
- [x] Regen button callback data is `tr:regen:<code>` format

**Acceptance Criteria — wordRepository.findByOriginalAndSource tests (mocked DB):**
- [x] Returns existing `Word` when `(userId, original, sourceLangId)` match
- [x] Returns `null` when no match found
- [x] Calls DB with correct WHERE conditions

**Acceptance Criteria — general:**
- [x] All new tests pass: `pnpm -r run test`
- [x] All pre-existing tests continue to pass (no regressions)
- [x] Test file naming follows project conventions (`*.test.ts`)

**Effort estimate:** 2–3 hours

---

## Architecture Constraints (Do Not Violate)

| Rule | Rationale |
|------|-----------|
| `sanitizeForStorage()` lives in `apps/bot` (not `adapters/db`) | Only `apps/bot` can see both `TranslateOutput` (core) and `StoredWordContent` (adapters/db). Putting it in `adapters/db` would create an upward `adapters/db → core` dependency |
| `wordRepository.create()` accepts `StoredWordContent`, not `TranslateOutput` | Enforces type-level sanitization guarantee — unsanitized `TranslateOutput` cannot be accidentally stored |
| `source_lang` text column is NOT dropped in this task | Retained for backward compat; will be dropped in migration 0006 (future task) |
| `sentence` input type is NEVER passed to `wordRepository.create()` | Sentence translations are not stored; `inputType` column CHECK constraint only allows `'word' | 'phrase'` |
| All `wordRepository` calls in grammY conversations must be wrapped in `conversation.external()` | grammY conversations replay handlers; external side effects must be isolated |

---

## Open Items (Out of Scope for This Task)

These are explicitly deferred per `@docs/tech-reqs/30-save-to-dictionary.md §11`:

| Item | Status |
|------|--------|
| Case-insensitive dedup (`LOWER(original)`) | Deferred to FEAT-30.1 |
| `word_target_langs` junction table for FK integrity of JSONB translation keys | Deferred to FEAT-30.1 |
| Drop `source_lang` text column (migration 0006) | Future migration |
| Phrase card visual differentiation (examples-first rendering) | Deferred |
| `/dictionary` browse command (FEAT-29) | Separate task |
| SRS scheduling on save | Milestone 2.0 |
