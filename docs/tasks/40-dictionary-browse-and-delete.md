# Task 40 — Dictionary Browse & Delete (/dictionary command)

**Status:** 🔲 Todo  
**Type:** Feature (DB + bot scene + renderer + i18n)  
**Priority:** High — first way for users to see and manage their saved vocabulary  
**Dependencies:**
- Task 39 (Normalize Vocabulary Schema — `vocabulary_entries` + `vocabulary_translations` must be live ✅)
- Task 30 (Save to Dictionary — users must have saved words ✅)

---

## Goal

Implement the `/dictionary` command that shows the user's personal dictionary as a **paginated list** (15 words per page) with inline navigation. Each word in the list can be expanded to view its full translation card, and **deleted** from the dictionary.

Additionally, **drop the obsolete `words` table** and remove the deprecated `wordRepository` — completing the cleanup deferred in Task 39 T8.

### Target User Flow

```
User: /dictionary
Bot: 📖 Your Dictionary (42 words)

  1. 🍎 apple — jablko, яблоко
  2. 🏠 house — dům, дом
  3. 🐱 cat — kočka, кот
  ...
  15. 🌊 ocean — oceán, океан

  [◀️ 1/3 ▶️]
  [✕ Close]

User: taps "🍎 apple"
Bot: (edits message to show full word card)

  🍎 apple [word · 🇬🇧]

  🇷🇺 яблоко [ˈjabləkə]
  neutral · A1
  🇨🇿 jablko [ˈjablkɔ]
  neutral · A1

  [🗑 Delete]  [← Back to list]

User: taps "🗑 Delete"
Bot: (confirmation)
  ⚠️ Delete "apple" from your dictionary?
  [✅ Yes, delete]  [← Cancel]

User: taps "✅ Yes, delete"
Bot: 🗑 Word deleted from dictionary.
     (returns to list, re-rendered without the deleted word)
```

---

## Architecture Overview

```
/dictionary command
   │
   ├── vocabularyRepository.countByUser(userId) → total
   ├── vocabularyRepository.findByUserPaginated(userId, offset, limit) → entries[]
   │
   └── Dictionary Renderer
        ├── renderDictionaryList(entries, page, totalPages, lang) → HTML
        ├── renderDictionaryEntry(entry, lang) → HTML (full card)
        ├── buildDictionaryListKeyboard(entries, page, totalPages, lang) → InlineKeyboard
        ├── buildDictionaryEntryKeyboard(entryId, lang) → InlineKeyboard
        └── buildDeleteConfirmKeyboard(entryId, lang) → InlineKeyboard
```

---

## What Is Already in Place (Do Not Re-Implement)

| Existing Feature | Location |
|---|---|
| `vocabulary_entries` + `vocabulary_translations` tables | `packages/adapters/db/src/schema.ts` |
| `vocabularyRepository.findByUser()` (all entries, no pagination) | `packages/adapters/db/src/repositories/vocabulary.repository.ts` |
| `vocabularyRepository.delete()` (soft-delete) | `packages/adapters/db/src/repositories/vocabulary.repository.ts` |
| `vocabularyRepository.findById()` | `packages/adapters/db/src/repositories/vocabulary.repository.ts` |
| `VocabularyEntryWithTranslations` type | `packages/adapters/db/src/repositories/vocabulary.repository.ts` |
| `t()` i18n function, `SupportedLang` | `@polyglot/core` |
| `getLangFlag()` language helpers | `@polyglot/core` |
| `BotContext`, `SessionData` | `apps/bot/src/types.ts` |
| `emptyDictionary`, `wordDeleted` i18n keys | All 3 locale files |
| `/dictionary` in bot command list | `apps/bot/src/commands/commands.ts` |
| `words` table (deprecated, to be dropped) | `packages/adapters/db/src/schema.ts` |
| `wordRepository` (deprecated) | `packages/adapters/db/src/repositories/word.repository.ts` |

---

## Execution Order & Dependencies

```
T1 (DB: add countByUser + findByUserPaginated to vocabularyRepository)
  │
  ├── T2 (i18n: add dictionary browse/delete keys — independent)
  │
  └── T3 (Renderer: dictionary list + entry + keyboards)
        │
        └── T4 (Bot: /dictionary command + dict:* callback handlers)
              │
              └── T5 (Drop obsolete `words` table + wordRepository)
                    │
                    └── T6 (Tests for all components)
```

T1 and T2 are independent — can run in parallel.
T3 depends on T2 (needs i18n keys for button labels).
T4 depends on T1 and T3.
T5 depends on T4 (all code using new tables, old ones unused).
T6 is the final quality gate.

---

## T1: DB — Add `countByUser()` + `findByUserPaginated()` to vocabularyRepository

**Goal:** Add pagination support to the vocabulary repository. The existing `findByUser()` loads ALL entries — fine for flash cards but not for a browse UI with 100+ words.

**Files:**
- MODIFY `packages/adapters/db/src/repositories/vocabulary.repository.ts`
- MODIFY `packages/adapters/db/src/index.ts` (export new types if any)

**Acceptance Criteria:**
- [ ] `vocabularyRepository.countByUser(userId: number): Promise<number>`
  - Returns the count of active vocabulary entries for the user
  - Query: `SELECT COUNT(*) FROM vocabulary_entries WHERE user_id = $userId AND is_active = true`
  - Returns `0` for users with no entries (not `null`)
- [ ] `vocabularyRepository.findByUserPaginated(userId: number, offset: number, limit: number): Promise<VocabularyEntryWithTranslations[]>`
  - Returns active entries with their active translations
  - Ordered by `createdAt DESC` (newest first, matching `findByUser()`)
  - Applies `OFFSET` and `LIMIT` for pagination
  - Returns empty array when offset is beyond total
  - Joins with `vocabulary_translations` (only active ones)
- [ ] `vocabularyRepository.hardDelete(entryId: number): Promise<void>`
  - **Hard delete** — actually removes the entry and all its translations from the DB
  - `DELETE FROM vocabulary_entries WHERE id = $entryId` (CASCADE handles translations)
  - Rationale: soft-delete for dictionary items is confusing — user expects "delete" to mean gone. Soft-delete remains available via existing `.delete()` for future use.
- [ ] All existing methods unchanged
- [ ] TypeScript compiles: `pnpm -r run build`

**Effort estimate:** 1–2 hours

---

## T2: i18n — Add Dictionary Browse/Delete Keys

**Goal:** Add all UI strings for the dictionary browse feature to all 3 locale files and to the `I18nKey` union type.

**Files:**
- MODIFY `packages/core/src/modules/i18n/locales/en.json`
- MODIFY `packages/core/src/modules/i18n/locales/ru.json`
- MODIFY `packages/core/src/modules/i18n/locales/cs.json`
- MODIFY `packages/core/src/modules/i18n/types.ts`

**Depends on:** none (independent)

**Acceptance Criteria:**
- [ ] `en.json` contains:
  ```json
  "dictionaryHeader": "📖 Your Dictionary ({count} words)",
  "dictionaryPage": "Page {page} of {total}",
  "dictionaryPrev": "◀️",
  "dictionaryNext": "▶️",
  "dictionaryClose": "✕ Close",
  "dictionaryBack": "← Back to list",
  "dictionaryDelete": "🗑 Delete",
  "dictionaryDeleteConfirm": "⚠️ Delete \"{word}\" from your dictionary?",
  "dictionaryDeleteYes": "✅ Yes, delete",
  "dictionaryDeleteCancel": "← Cancel",
  "dictionarySessionExpired": "Session expired. Use /dictionary to restart."
  ```
- [ ] `ru.json` contains:
  ```json
  "dictionaryHeader": "📖 Ваш словарь ({count} слов)",
  "dictionaryPage": "Стр. {page} из {total}",
  "dictionaryPrev": "◀️",
  "dictionaryNext": "▶️",
  "dictionaryClose": "✕ Закрыть",
  "dictionaryBack": "← К списку",
  "dictionaryDelete": "🗑 Удалить",
  "dictionaryDeleteConfirm": "⚠️ Удалить \"{word}\" из словаря?",
  "dictionaryDeleteYes": "✅ Да, удалить",
  "dictionaryDeleteCancel": "← Отмена",
  "dictionarySessionExpired": "Сессия истекла. Используйте /dictionary для перезапуска."
  ```
- [ ] `cs.json` contains:
  ```json
  "dictionaryHeader": "📖 Váš slovník ({count} slov)",
  "dictionaryPage": "Str. {page} z {total}",
  "dictionaryPrev": "◀️",
  "dictionaryNext": "▶️",
  "dictionaryClose": "✕ Zavřít",
  "dictionaryBack": "← Zpět na seznam",
  "dictionaryDelete": "🗑 Smazat",
  "dictionaryDeleteConfirm": "⚠️ Smazat \"{word}\" ze slovníku?",
  "dictionaryDeleteYes": "✅ Ano, smazat",
  "dictionaryDeleteCancel": "← Zrušit",
  "dictionarySessionExpired": "Relace vypršela. Použijte /dictionary pro restart."
  ```
- [ ] `I18nKey` union in `types.ts` includes all new keys:
  `"dictionaryHeader"`, `"dictionaryPage"`, `"dictionaryPrev"`, `"dictionaryNext"`, `"dictionaryClose"`, `"dictionaryBack"`, `"dictionaryDelete"`, `"dictionaryDeleteConfirm"`, `"dictionaryDeleteYes"`, `"dictionaryDeleteCancel"`, `"dictionarySessionExpired"`
- [ ] `I18nParams` interface in `types.ts` updated with parameter types:
  ```typescript
  dictionaryHeader: { count: string | number };
  dictionaryPage: { page: string | number; total: string | number };
  dictionaryDeleteConfirm: { word: string };
  ```
- [ ] TypeScript compiles — no missing key errors in `t()` call sites

**Effort estimate:** 1 hour

---

## T3: Renderer — Dictionary List + Entry + Keyboards

**Goal:** Create a Telegram-specific renderer for the dictionary browse UI: paginated list view, single entry detail view, and all associated keyboards.

**Files:**
- CREATE `apps/bot/src/renderers/dictionary.renderer.ts`

**Depends on:** T2 (needs i18n keys)

**Acceptance Criteria:**

### `renderDictionaryList()`
- [ ] Signature:
  ```typescript
  export function renderDictionaryList(
    entries: VocabularyEntryWithTranslations[],
    page: number,        // 1-based
    totalPages: number,
    totalWords: number,
    lang: SupportedLang,
  ): string
  ```
- [ ] Output format:
  ```
  📖 Your Dictionary (42 words)

  1. 🍎 <b>apple</b> — jablko, яблоко
  2. 🏠 <b>house</b> — dům, дом
  ...
  15. 🌊 <b>ocean</b> — oceán, океán

  Page 1 of 3
  ```
- [ ] Each line shows: `{index}. {emoji} <b>{original}</b> — {translation1}, {translation2}` (max 2 translations, comma-separated, just the `text` field)
- [ ] If entry has more than 2 translations: `{t1}, {t2}, +{n}` (e.g. "jablko, яблоко, +1")
- [ ] Index is global (page 2 starts at 16, not 1)
- [ ] All text is HTML-escaped

### `renderDictionaryEntry()`
- [ ] Signature:
  ```typescript
  export function renderDictionaryEntry(
    entry: VocabularyEntryWithTranslations,
    langResolver: (id: number) => string | undefined,
    lang: SupportedLang,
  ): string
  ```
- [ ] Output format (similar to flashcard back, but standalone):
  ```
  {emoji} <b>{original}</b>
  <i>{inputType} · {sourceLangFlag}</i>

  {flag} <b>{text}</b> [{transcription}]
  {register} · {cefr}
  ({synonym1}, {synonym2})
  💬 example sentence

  {flag2} <b>{text2}</b> ...
  ```
- [ ] Uses `langResolver` to convert `targetLangId` → language code for flags
- [ ] Shows all translations (not paginated within a card)
- [ ] Includes synonyms and examples from `details` JSONB
- [ ] HTML-escaped

### `buildDictionaryListKeyboard()`
- [ ] Signature:
  ```typescript
  export function buildDictionaryListKeyboard(
    entries: VocabularyEntryWithTranslations[],
    page: number,
    totalPages: number,
    lang: SupportedLang,
  ): InlineKeyboard
  ```
- [ ] **Row per entry**: each entry gets a button with text `"{emoji} {original}"` and callback data `"dict:view:{entryId}"`
- [ ] **Navigation row**: `[◀️ Prev] [{page}/{total}] [▶️ Next]`
  - `◀️` callback: `dict:page:{page-1}` — hidden when on page 1
  - `{page}/{total}` is a no-op button with callback `dict:noop`
  - `▶️` callback: `dict:page:{page+1}` — hidden when on last page
  - When only 1 page: navigation row is omitted entirely
- [ ] **Close row**: `[✕ Close]` with callback `dict:close`

### `buildDictionaryEntryKeyboard()`
- [ ] Signature:
  ```typescript
  export function buildDictionaryEntryKeyboard(
    entryId: number,
    page: number,
    lang: SupportedLang,
  ): InlineKeyboard
  ```
- [ ] Row 1: `[🗑 Delete]` with callback `dict:delete:{entryId}`
- [ ] Row 2: `[← Back to list]` with callback `dict:page:{page}` (returns to the page the user was on)

### `buildDeleteConfirmKeyboard()`
- [ ] Signature:
  ```typescript
  export function buildDeleteConfirmKeyboard(
    entryId: number,
    page: number,
    lang: SupportedLang,
  ): InlineKeyboard
  ```
- [ ] Row 1: `[✅ Yes, delete]` with callback `dict:confirm-delete:{entryId}:{page}`
- [ ] Row 2: `[← Cancel]` with callback `dict:view:{entryId}:{page}` (returns to entry view)

**Effort estimate:** 3 hours

---

## T4: Bot — `/dictionary` Command + `dict:*` Callback Handlers

**Goal:** Wire the `/dictionary` command and all `dict:*` callback handlers into the bot.

**Files:**
- CREATE `apps/bot/src/scenes/dictionary.scene.ts` (command handler)
- CREATE `apps/bot/src/scenes/helpers/dictionary.helper.ts` (callback handlers)
- MODIFY `apps/bot/src/index.ts` (register command + callbacks)
- MODIFY `apps/bot/src/types.ts` (add dictionary session state)

**Depends on:** T1, T3

### Session state additions

- [ ] Extend `SessionData` in `apps/bot/src/types.ts`:
  ```typescript
  /** Dictionary browse state */
  dictionary?: {
    /** Current page (1-based) */
    currentPage: number;
    /** Message ID of the dictionary message (for in-place editing) */
    msgId?: number;
  };
  ```

### `/dictionary` command handler (`dictionary.scene.ts`)

- [ ] Signature: `export async function handleDictionaryCommand(ctx: BotContext): Promise<void>`
- [ ] Resolves user's interface language via `userRepository.findById()` → `interfaceLang`
- [ ] Calls `vocabularyRepository.countByUser(ctx.user.id)` for total
- [ ] If `total === 0`: replies with `t('emptyDictionary', lang)` and returns
- [ ] Calls `vocabularyRepository.findByUserPaginated(ctx.user.id, 0, 15)` for first page
- [ ] Calculates `totalPages = Math.ceil(total / 15)`
- [ ] Sends message with `renderDictionaryList()` + `buildDictionaryListKeyboard()`
- [ ] Stores `{ currentPage: 1, msgId: msg.message_id }` in `ctx.session.dictionary`

### Callback handlers (`dictionary.helper.ts`)

| Callback Pattern | Handler | Action |
|---|---|---|
| `dict:page:{n}` | `handleDictPage` | Load page N, edit message with list view |
| `dict:view:{entryId}` or `dict:view:{entryId}:{page}` | `handleDictView` | Load entry, edit message with entry detail view |
| `dict:delete:{entryId}` | `handleDictDelete` | Edit message to show delete confirmation |
| `dict:confirm-delete:{entryId}:{page}` | `handleDictConfirmDelete` | Delete entry, return to list |
| `dict:close` | `handleDictClose` | Delete the dictionary message, clear session |
| `dict:noop` | `handleDictNoop` | `answerCallbackQuery()` — no action |

#### `handleDictPage(ctx)` — Pagination
- [ ] Extracts page number from callback data: `ctx.callbackQuery.data.split(':')[2]`
- [ ] Calls `vocabularyRepository.countByUser()` + `vocabularyRepository.findByUserPaginated(userId, (page-1)*15, 15)`
- [ ] Edits message with `renderDictionaryList()` + `buildDictionaryListKeyboard()`
- [ ] Updates `ctx.session.dictionary.currentPage = page`
- [ ] Answers callback query

#### `handleDictView(ctx)` — View Single Entry
- [ ] Extracts `entryId` (and optional `page`) from callback data
- [ ] Calls `vocabularyRepository.findById(entryId)`
- [ ] If not found: `answerCallbackQuery({ text: t('noResults', lang) })`; return
- [ ] Edits message with `renderDictionaryEntry()` + `buildDictionaryEntryKeyboard(entryId, page)`
- [ ] Uses `getLang(id)?.code` as the `langResolver` for rendering
- [ ] Answers callback query

#### `handleDictDelete(ctx)` — Delete Confirmation
- [ ] Extracts `entryId` from callback data
- [ ] Calls `vocabularyRepository.findById(entryId)` to get the word's `original` text
- [ ] Edits message to show: `t('dictionaryDeleteConfirm', lang, { word: entry.original })`
- [ ] Keyboard: `buildDeleteConfirmKeyboard(entryId, currentPage, lang)`
- [ ] Answers callback query

#### `handleDictConfirmDelete(ctx)` — Execute Delete
- [ ] Extracts `entryId` and `page` from callback data
- [ ] Calls `vocabularyRepository.hardDelete(entryId)`
- [ ] Answers callback query with `t('wordDeleted', lang)`
- [ ] Re-counts and re-fetches the page:
  - If the current page is now empty (all items deleted) and page > 1: go to page - 1
  - If dictionary is now completely empty: edit message to `t('emptyDictionary', lang)` with no keyboard
- [ ] Otherwise: edits message back to the list view (re-rendered without deleted word)

#### `handleDictClose(ctx)` — Close Dictionary
- [ ] Deletes the message via `ctx.deleteMessage()`
- [ ] Clears `ctx.session.dictionary`
- [ ] Answers callback query (best-effort — message may already be deleted)

#### `handleDictNoop(ctx)` — No-op for page indicator button
- [ ] Calls `ctx.answerCallbackQuery()` with no parameters

### Bot wiring (`index.ts`)
- [ ] Register `/dictionary` command: `bot.command("dictionary", handleDictionaryCommand)`
- [ ] Register callbacks:
  ```typescript
  bot.callbackQuery(/^dict:page:/, handleDictPage);
  bot.callbackQuery(/^dict:view:/, handleDictView);
  bot.callbackQuery(/^dict:delete:/, handleDictDelete);
  bot.callbackQuery(/^dict:confirm-delete:/, handleDictConfirmDelete);
  bot.callbackQuery("dict:close", handleDictClose);
  bot.callbackQuery("dict:noop", handleDictNoop);
  ```
- [ ] Import handlers from `./scenes/helpers/dictionary.helper.js`
- [ ] Import command handler from `./scenes/dictionary.scene.js`
- [ ] Update session initial state to include `dictionary: undefined`

### Error handling
- [ ] All `editMessageText` calls wrapped in try/catch — log error, answer callback
- [ ] Session loss (no `ctx.session.dictionary`): answer with `t('dictionarySessionExpired', lang)`
- [ ] `findById` returns null (entry deleted by another session): answer with `t('noResults', lang)`, return to list

**Effort estimate:** 4–5 hours

---

## T5: Drop Obsolete `words` Table + `wordRepository`

**Goal:** Complete the cleanup deferred from Task 39 T8. Remove the deprecated `words` table definition, the `word.repository.ts` file, and all associated exports. Also clean up the old `sanitize-word-content.ts`.

**Files:**
- MODIFY `packages/adapters/db/src/schema.ts` — remove `words` table definition
- DELETE `packages/adapters/db/src/repositories/word.repository.ts`
- MODIFY `packages/adapters/db/src/index.ts` — remove `wordRepository` and related type exports, remove `StoredWordContent` import in schema
- DELETE `apps/bot/src/utils/sanitize-word-content.ts` (superseded by `vocabulary-mapper.ts`)
- DELETE `apps/bot/src/utils/sanitize-word-content.test.ts` (if exists)
- MODIFY any remaining files that import from `word.repository.ts`

**Depends on:** T4 (all dictionary features using normalized schema)

**Acceptance Criteria:**
- [ ] `words` table definition **removed** from `packages/adapters/db/src/schema.ts`
- [ ] `StoredWordContent` import removed from `schema.ts` (was used by `words.content` column typing)
- [ ] `packages/adapters/db/src/repositories/word.repository.ts` **deleted**
- [ ] All exports of `wordRepository`, `Word`, `NewWord`, `CreateWordInput`, `StoredWordContent`, `StoredLanguageTranslation` **removed** from `packages/adapters/db/src/index.ts`
- [ ] `apps/bot/src/utils/sanitize-word-content.ts` **deleted** (if it still exists)
- [ ] No remaining imports of `word.repository` or `sanitize-word-content` anywhere in the codebase
- [ ] Migration `0011_drop_legacy_words.sql` already exists — verify it is correct and references the right table
- [ ] TypeScript compiles: `pnpm -r run build`
- [ ] All tests pass: `pnpm -r run test`

**Effort estimate:** 1–2 hours

---

## T6: Tests

**Goal:** Comprehensive tests for all new/changed components.

**Files:**
- CREATE `packages/adapters/db/src/__tests__/vocabulary-pagination.repository.test.ts`
- CREATE `apps/bot/src/renderers/__tests__/dictionary.renderer.test.ts`
- CREATE `apps/bot/src/scenes/helpers/__tests__/dictionary.helper.test.ts`
- MODIFY existing tests that import from `word.repository` (update or remove)

**Depends on:** T1, T2, T3, T4, T5

**Acceptance Criteria:**

### vocabularyRepository pagination tests
- [ ] `countByUser()`: returns correct count for user with entries
- [ ] `countByUser()`: returns `0` for user with no entries
- [ ] `countByUser()`: does not count soft-deleted entries (`isActive: false`)
- [ ] `findByUserPaginated()`: returns correct page of entries
- [ ] `findByUserPaginated()`: offset 0, limit 15 returns first 15 (or fewer if < 15 total)
- [ ] `findByUserPaginated()`: offset 15, limit 15 returns next page
- [ ] `findByUserPaginated()`: offset beyond total returns empty array
- [ ] `findByUserPaginated()`: entries include their active translations
- [ ] `findByUserPaginated()`: ordered by `createdAt DESC`
- [ ] `hardDelete()`: removes entry and translations from DB (not soft-delete)

### dictionary.renderer tests
- [ ] `renderDictionaryList()`: contains header with word count
- [ ] `renderDictionaryList()`: each entry shows emoji + original + translation summaries
- [ ] `renderDictionaryList()`: entries with >2 translations show "+N" suffix
- [ ] `renderDictionaryList()`: global indexing (page 2 starts at 16)
- [ ] `renderDictionaryList()`: HTML characters are escaped
- [ ] `renderDictionaryEntry()`: contains original word, translations with transcription, CEFR, synonyms
- [ ] `buildDictionaryListKeyboard()`: has one button per entry with `dict:view:{id}` callback
- [ ] `buildDictionaryListKeyboard()`: has navigation buttons when > 1 page
- [ ] `buildDictionaryListKeyboard()`: no prev button on page 1
- [ ] `buildDictionaryListKeyboard()`: no next button on last page
- [ ] `buildDictionaryListKeyboard()`: no navigation row when 1 page
- [ ] `buildDictionaryListKeyboard()`: has close button
- [ ] `buildDictionaryEntryKeyboard()`: has delete and back buttons
- [ ] `buildDeleteConfirmKeyboard()`: has confirm-delete and cancel buttons

### dictionary.helper callback tests (mocked ctx)
- [ ] `handleDictPage()`: calls `findByUserPaginated` with correct offset
- [ ] `handleDictView()`: calls `findById` and edits message
- [ ] `handleDictDelete()`: shows confirmation with word name
- [ ] `handleDictConfirmDelete()`: calls `hardDelete` and returns to list
- [ ] `handleDictConfirmDelete()`: goes to previous page when current page becomes empty
- [ ] `handleDictClose()`: deletes message and clears session
- [ ] Session loss: returns `dictionarySessionExpired` message

### General
- [ ] All new tests pass: `pnpm -r run test`
- [ ] All pre-existing tests pass (no regressions after `words` table removal)
- [ ] TypeScript compiles: `pnpm -r run build`

**Effort estimate:** 3–4 hours

---

## Architecture Constraints (Do Not Violate)

| Rule | Rationale |
|------|-----------|
| Page size is 15 (constant, not configurable per-user) | Telegram message length limits; 15 entries × ~40 chars = ~600 chars — well within 4096 limit |
| Hard delete for user-facing "Delete" action | Users expect "delete" to mean gone. Soft-delete causes confusion ("I deleted it but it's still in flash cards"). |
| Callback data max 64 bytes (Telegram limit) | `dict:confirm-delete:{id}:{page}` — must stay under 64 bytes. Entry IDs are integers (typically <10 digits). |
| No conversation API for dictionary browse | Callback-based navigation (like flash cards) — survives bot restarts, no conversation state to lose. |
| `words` table DROP must be a separate migration | Already exists as `0011_drop_legacy_words.sql` — just verify and clean up code references. |
| All `vocabularyRepository` calls are NOT in conversations | Dictionary uses direct callback handlers, not grammY conversations — no `conversation.external()` needed. |

---

## Constants

```typescript
/** Number of words shown per page in /dictionary */
export const DICTIONARY_PAGE_SIZE = 15;
```

Location: `apps/bot/src/scenes/helpers/dictionary.helper.ts` (or a shared constants file).

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Dictionary is empty | `/dictionary` replies with `emptyDictionary` — no list shown |
| Fewer than 15 words | Single page, no navigation buttons |
| Exactly 15 words | Single page, no navigation buttons |
| 16 words | 2 pages (15 + 1), navigation shown |
| Delete last word on page 3 (page becomes empty) | Auto-navigate to page 2 |
| Delete last word in dictionary | Show `emptyDictionary` message |
| Entry deleted by another session (race) | `findById` returns null → answer with "No results", return to list |
| Session expired (bot restart) | Callback returns `dictionarySessionExpired` message |
| Message too old to edit (Telegram 48h limit) | Catch error, log, answer callback with error toast |
| Very long word/phrase in list | Truncate to ~30 chars with "…" in list view (full text in detail view) |
| User taps ◀️ on page 1 | Button is not shown (prev hidden on page 1) |
| User taps ▶️ on last page | Button is not shown (next hidden on last page) |
| Concurrent taps (double-tap on delete) | Second `hardDelete` is no-op (entry already gone). `findById` returns null → handle gracefully. |

---

## Files to Create

| File | Description |
|---|---|
| `apps/bot/src/renderers/dictionary.renderer.ts` | Dictionary list + entry renderer + keyboards |
| `apps/bot/src/scenes/dictionary.scene.ts` | `/dictionary` command handler |
| `apps/bot/src/scenes/helpers/dictionary.helper.ts` | `dict:*` callback handlers |
| `packages/adapters/db/src/__tests__/vocabulary-pagination.repository.test.ts` | Pagination + hardDelete tests |
| `apps/bot/src/renderers/__tests__/dictionary.renderer.test.ts` | Renderer tests |
| `apps/bot/src/scenes/helpers/__tests__/dictionary.helper.test.ts` | Callback handler tests |

## Files to Modify

| File | Change |
|---|---|
| `packages/adapters/db/src/repositories/vocabulary.repository.ts` | Add `countByUser()`, `findByUserPaginated()`, `hardDelete()` |
| `packages/adapters/db/src/index.ts` | Remove `wordRepository` exports; clean up `StoredWordContent` types |
| `packages/adapters/db/src/schema.ts` | Remove `words` table definition + `StoredWordContent` import |
| `packages/core/src/modules/i18n/locales/en.json` | Add 11 dictionary browse keys |
| `packages/core/src/modules/i18n/locales/ru.json` | Add 11 dictionary browse keys |
| `packages/core/src/modules/i18n/locales/cs.json` | Add 11 dictionary browse keys |
| `packages/core/src/modules/i18n/types.ts` | Add 11 keys to `I18nKey` + 3 entries to `I18nParams` |
| `apps/bot/src/types.ts` | Add `dictionary?: {...}` to `SessionData` |
| `apps/bot/src/index.ts` | Register `/dictionary` command + `dict:*` callbacks + session init |

## Files to Delete

| File | Reason |
|---|---|
| `packages/adapters/db/src/repositories/word.repository.ts` | Deprecated — replaced by `vocabulary.repository.ts` |
| `apps/bot/src/utils/sanitize-word-content.ts` | Superseded by `vocabulary-mapper.ts` |
| `apps/bot/src/utils/sanitize-word-content.test.ts` | Tests for deleted file |

---

## Effort Estimate

| Subtask | Estimate |
|---------|----------|
| T1 — DB pagination + hardDelete | 1–2h |
| T2 — i18n keys | 1h |
| T3 — Dictionary renderer | 3h |
| T4 — Bot command + callbacks | 4–5h |
| T5 — Drop words table cleanup | 1–2h |
| T6 — Tests | 3–4h |
| **Total** | **~13–16h** |

---

## Acceptance Criteria (Task-level)

- [ ] `/dictionary` command shows paginated list of saved words (15 per page)
- [ ] List shows emoji, word, and up to 2 translation summaries per entry
- [ ] Navigation buttons (◀️ ▶️) allow paging through the dictionary
- [ ] Tapping a word shows its full translation card with all languages, transcriptions, synonyms, examples
- [ ] "🗑 Delete" button shows a confirmation prompt
- [ ] Confirming delete removes the word from the database and refreshes the list
- [ ] Empty dictionary shows `emptyDictionary` message
- [ ] Session loss on callbacks shows `dictionarySessionExpired` message
- [ ] Deleting the last word on a page navigates to the previous page
- [ ] Deleting the last word in the dictionary shows `emptyDictionary`
- [ ] `words` table definition removed from `schema.ts`
- [ ] `word.repository.ts` deleted
- [ ] `sanitize-word-content.ts` deleted
- [ ] All 3 locale files have 11 new `dictionary*` keys
- [ ] All packages build: `pnpm -r run build`
- [ ] All tests pass: `pnpm -r run test`
