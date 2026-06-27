# Integration Review — FEAT-30 Save to Dictionary

**Reviewer:** Integrator Agent  
**Date:** 2026-03-28  
**Artifacts reviewed:**
- `@docs/requirements/30-save-to-dictionary.md`
- `@docs/mvp-scope.md`
- `@docs/tech-reqs/30-save-to-dictionary.md`
- `@docs/tasks/30-save-to-dictionary.md`
- `@docs/tasks/27-input-type-detection-and-text-limits.md` (upstream reference)
- `packages/adapters/db/src/repositories/word.repository.ts` (current code)
- `packages/adapters/db/src/schema.ts` (current code)
- `packages/adapters/db/src/index.ts` (current code)
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` (current code)
- `apps/bot/src/scenes/helpers/regen.helper.ts` (current code)
- `apps/bot/src/renderers/translation.renderer.ts` (current code)
- `apps/bot/src/types.ts` (current code)
- `apps/bot/src/index.ts` (current code)
- `packages/core/src/modules/i18n/locales/en.json` (current code)
- `packages/core/src/modules/i18n/types.ts` (current code)

---

## Summary

9 issues found across all severity levels. 2 Critical, 4 Major, 3 Minor.

The most serious issues are: (1) T9 updates dead code that is never called in production, and (2) T3's breaking signature change creates a broken build window unless all dependent tasks are shipped atomically. Additionally, there are naming mismatches, task ownership overlaps, and a missing defensive guard in the save handler.

---

## Issues

---

### [CRITICAL-1] T9 Updates Dead Code — `handleRegenLoop` Is Not Called in Production

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T9) vs `apps/bot/src/index.ts` + `apps/bot/src/middlewares/mode-router.ts`

**Mismatch:**  
T9 allocates 2 hours to update `handleRegenLoop()` in `regen.helper.ts` with FEAT-30 dedup, sanitization, and new keyboard logic. However, `handleRegenLoop` is **never called from any production bot code**. Searching all non-test `.ts` files in `apps/bot/src/` yields only a single result: the function definition itself. The bot uses `handleRegenCallback()` from `translate-mode.helper.ts` (registered as `bot.callbackQuery(/^tr:regen:/, handleRegenCallback)` in `index.ts`). `handleRegenLoop` is a grammY conversation-based handler that was likely superseded when the bot switched from conversation-based to persistent-mode routing (Task 27).

The only test file referencing `handleRegenLoop` is `regen.helper.test.ts`, which confirms it exists only as tested dead code.

**Impact:** T9 implements a complete feature path (dedup, sanitize, new keyboard) in a function that never executes at runtime. All 2 hours of effort have zero user-facing impact. More critically: after T9, `regen.helper.ts` will import `sanitizeForStorage`, `buildPostSaveKeyboard`, and new repository methods — passing tests that cover behavior that does not run in production.

**Resolution:**  
Option A (Recommended): Deprecate and remove `handleRegenLoop` (it is dead code). Update T9 to instead verify that `handleRegenCallback()` in `translate-mode.helper.ts` fully covers all FEAT-30 regen scenarios (which it does, per T8). Update `regen.helper.test.ts` to reflect the deletion.  
Option B: If `handleRegenLoop` is intended for future conversation-based flow revival, add a code comment and a `TODO` linking it to a future task. Update T9 scope description to explicitly say "test coverage only — not active in production."

---

### [CRITICAL-2] T3 Breaking Signature Change Creates Uncompilable Build Window

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T3, T7, T8, T9) vs `apps/bot/src/scenes/helpers/regen.helper.ts` + `apps/bot/src/scenes/helpers/translate-mode.helper.ts`

**Mismatch:**  
T3 replaces `wordRepository.create(userId, word: Omit<NewWord, "userId">)` with `wordRepository.create(userId, input: CreateWordInput)`. This is a breaking change to an existing API. Immediately after T3 is merged, two call sites are broken:

1. `regen.helper.ts` (line using `{ original, sourceLang, content: current }`) — lacks `sourceLangId` and `inputType`, passes old `sourceLang` text field
2. `translate-mode.helper.ts` (existing `handleSaveCallback`) — calls `{ original, sourceLang, content: output }` which no longer matches `CreateWordInput`

T7 fixes `translate-mode.helper.ts` and T9 fixes `regen.helper.ts`, but both depend on T3. If T3 is merged to main before T7/T8/T9, TypeScript compilation fails and CI breaks. The dependency chain in Task 30 shows T7→T3 and T9→T3, but does not specify that they must be in the same PR/commit.

**Impact:** Broken build between task merges. CI gate will fail on any commit that includes T3 without T7/T9.

**Resolution:**  
T3 and T7/T8/T9 must be implemented and merged atomically — either in a single branch/PR, or with a short-lived compatibility shim (e.g., a transitional `create()` overload that accepts the old shape) that is removed in T7/T9. Recommend adding a note to T3: "Must be merged alongside T7, T8, and T9 in a single PR to avoid compilation errors."

---

### [MAJOR-1] Naming Mismatch — `TranslationKey` vs `I18nKey`

**Conflicting artifacts:** `@docs/tech-reqs/30-save-to-dictionary.md §3.3` + `@docs/tasks/30-save-to-dictionary.md` (T4) vs `packages/core/src/modules/i18n/types.ts`

**Mismatch:**  
Both the tech-reqs and T4 reference "the `TranslationKey` union type" when specifying that `saveWord` and `savePhrase` should be added. However, no `TranslationKey` type exists anywhere in the codebase. The actual union type is `I18nKey`, defined in `packages/core/src/modules/i18n/types.ts:5`. The `t()` function is typed against `I18nKey`. This occurs in:

- Tech-reqs §3.3: `"type TranslationKey = ... | 'saveWord' | 'savePhrase'"`
- T4 acceptance criteria: `"TranslationKey union type in types.ts includes 'saveWord' and 'savePhrase'"`

**Impact:** An implementer following the task spec may search for `TranslationKey` and fail to find it, then either create a duplicate type or incorrectly guess the correct file/type to update. TypeScript compilation of `t('saveWord', lang)` in T6 depends on T4 updating `I18nKey` (not `TranslationKey`). If the wrong type is updated, the `t()` call in T6 will produce a TypeScript error.

**Resolution:**  
Replace every occurrence of "TranslationKey" in `@docs/tech-reqs/30-save-to-dictionary.md` and `@docs/tasks/30-save-to-dictionary.md` with `I18nKey`. T4's acceptance criteria should read: "The `I18nKey` union type in `packages/core/src/modules/i18n/types.ts` includes `'saveWord'` and `'savePhrase'`."

---

### [MAJOR-2] T6 Acceptance Criteria Overlap with T8 and T9 — Ambiguous Task Ownership

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T6 vs T8 vs T9)

**Mismatch:**  
T6's acceptance criteria state: "All existing callers of `buildTranslationKeyboard` are updated to pass `inputType`", explicitly listing both `translate-mode.helper.ts` and `regen.helper.ts`. However:
- T8 also modifies `translate-mode.helper.ts` (update `handleTranslateText` and `handleRegenCallback`)
- T9 also modifies `regen.helper.ts` (update `handleRegenLoop`)

This creates three-way ownership of the same files. If a developer implements T6 (updating both call sites as the AC requires), they will cause merge conflicts with T8 and T9. If they only update the renderer (not the callers), T6's AC is unfulfilled. The dependency model (T8 depends on T6, T9 depends on T6) suggests T6 should NOT update callers — only the renderer.

Furthermore: after T6 adds the required `inputType` parameter to `buildTranslationKeyboard`, the existing call sites in `translate-mode.helper.ts` and `regen.helper.ts` will **immediately fail TypeScript compilation** (missing argument). T8 and T9 must fix this. But T6's own AC says it updates those callers — making T8 and T9 redundant for those specific lines.

**Impact:** Merge conflicts, double-implementation, or unclear acceptance of T6 during review. If T6 is marked "done" without updating callers (the correct behavior per dependency graph), it fails its own stated AC. If it DOES update callers, it creates conflicts with T8/T9.

**Resolution:**  
Amend T6 acceptance criteria to: "The `buildTranslationKeyboard` function signature is updated. Call sites in `translate-mode.helper.ts` and `regen.helper.ts` are intentionally **not** updated by T6 — this is handled in T8 and T9 respectively." This removes the ambiguity and aligns T6 scope with its position in the dependency chain.

---

### [MAJOR-3] Tech-Reqs §2 Package Dependency Constraint Is Factually Incorrect

**Conflicting artifacts:** `@docs/tech-reqs/30-save-to-dictionary.md §2` vs `packages/adapters/db/package.json`

**Mismatch:**  
The tech-reqs §2 states as a hard rule: "Package dependency rules: `packages/adapters/db` has no dependency on `packages/core` or `apps/*`." This is then used as the architectural rationale for why `sanitizeForStorage()` must live in `apps/bot` ("Only `apps/bot` can see both `TranslateOutput` (core) and `StoredWordContent` (adapters/db). Putting it in `adapters/db` would create an upward `adapters/db → core` dependency").

However, `packages/adapters/db/package.json` already lists `"@polyglot/core": "workspace:*"` as a runtime dependency. The `adapters/db` package already imports from `@polyglot/core` (e.g., for language cache types). The stated constraint is **already violated** in the current codebase.

Consequently, T2's `StoredLanguageTranslation` interface (which imports `CefrLevel`, `Example`, `ExpressionType`, `Register`, `Synonym`, `TranslationVariant` from `@polyglot/core`) does NOT actually violate any rule — the dependency already exists. The tech-reqs' note §3.1 even admits "In practice the file will import from core" while §2 says it shouldn't.

**Impact:** The stated design rationale for placing `sanitizeForStorage` in `apps/bot` is misleading. The actual correct rationale is: `sanitizeForStorage` should live in `apps/bot` because it performs a transformation between `TranslateOutput` (a pipeline-level type) and `StoredWordContent` (a storage-level type) — a responsibility that belongs at the application layer, not the DB adapter. The current false rationale may confuse future developers modifying the architecture.

**Resolution:**  
Update tech-reqs §2 to accurately state: "`packages/adapters/db` already imports from `@polyglot/core` (workspace dependency). The correct layering principle is: `apps/bot` is responsible for transforming pipeline types into storage types — `sanitizeForStorage()` belongs in `apps/bot` because it is a bot-layer concern, not a DB concern." Remove the false "adapters/db has no dependency on core" constraint.

---

### [MAJOR-4] Missing Defensive Guard in T7 — `lastInputType === 'sentence'` Reaches `wordRepository.create()`

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T7) vs Architecture Constraint in same document

**Mismatch:**  
T7 specifies that `handleSaveCallback` reads `inputType = ctx.session.lastInputType ?? 'word'` and passes it as `inputType: inputType as 'word' | 'phrase'` to `wordRepository.create()`. The architecture constraints section says: "Sentence input type is NEVER passed to `wordRepository.create()`. Sentence translations are not stored; `inputType` column CHECK constraint only allows `'word' | 'phrase'`."

However, T7 has no explicit guard against `lastInputType === 'sentence'`. The TypeScript cast `inputType as 'word' | 'phrase'` silently overrides the type. The DB CHECK constraint would catch this at runtime, but only after a failed DB round-trip that throws an exception.

This edge case can occur in the following scenario: user translates a sentence (which sets `lastInputType = 'sentence'` and clears `pendingTranslation`), then taps a stale Save button on a previous word translation message (which still has `pendingTranslation` set from before the session was updated). In this case, `pendingTranslation` is truthy but `lastInputType` is 'sentence'. T7's flow would proceed past the `pendingTranslation` undefined check and attempt to save with `inputType = 'sentence'`.

**Impact:** DB constraint violation at runtime causes an unhandled exception in the save handler. The user sees a generic error. This violates the architecture constraint stated in the task itself.

**Resolution:**  
Add an early-return guard in T7's `handleSaveCallback()`:
```typescript
const inputType = ctx.session.lastInputType;
if (!inputType || inputType === 'sentence') {
  await ctx.answerCallbackQuery();
  return;
}
```
This should be Step 1.5 (after the `pendingTranslation` undefined check, before the FK resolution step).

---

### [MINOR-1] `saveToDictionary` i18n Key Becomes Orphaned After T6

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T6) vs `packages/core/src/modules/i18n/locales/en.json` + `packages/core/src/modules/i18n/types.ts`

**Mismatch:**  
The current `buildTranslationKeyboard()` uses `t('saveToDictionary', lang)` (value: `"➕ Save to dictionary"`). After T6 replaces this with `t('saveWord', lang)` / `t('savePhrase', lang)`, the `saveToDictionary` key (`"➕ Save to dictionary"`) in all locale files and in `I18nKey` union will be unreferenced. REQ-3006 says "The existing generic `saveToDictionary` i18n key is deprecated or repurposed" — but no task covers the actual deprecation or removal.

Note: there is also a separate `saveToDict` key (`"💾 Save to dictionary?"`) which may or may not be used elsewhere. Neither key is scheduled for cleanup.

**Impact:** Technical debt — orphaned i18n keys in locale files and the TypeScript union. No functional breakage, but the keys mislead future developers and inflate the i18n type surface.

**Resolution:**  
Option A: Add a sub-task to T4 or T6 to remove or comment out `saveToDictionary` from all locale files and from `I18nKey`. Verify no other callers use it first (grep for `t('saveToDictionary'`).  
Option B: Add a follow-up item to the Open Items table in `@docs/tasks/30-save-to-dictionary.md`: "Remove orphaned `saveToDictionary` and `saveToDict` i18n keys".

---

### [MINOR-2] `SessionData` Initial Factory in `index.ts` Not Updated for `savedWordId`

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T5) vs `apps/bot/src/index.ts`

**Mismatch:**  
T5 adds `savedWordId?: number` to the `SessionData` interface. However, the session initial factory in `apps/bot/src/index.ts` explicitly initializes all session fields:
```typescript
initial: (): SessionData => ({
  activeMode: "translate",
  pendingTranslation: undefined,
  pendingCardMsgId: undefined,
  nextSourceLang: null,
  lastTranslation: undefined,
  lastInputType: undefined,
  // savedWordId is missing
})
```
Since `savedWordId` is optional (`?`), TypeScript will not flag the missing initialization. However, the session factory is documented as explicitly initializing all fields — inconsistency between the interface and factory creates confusion for future developers about the default state.

**Impact:** Minor code quality issue. No functional breakage (undefined is the correct initial value). Future developers maintaining the session shape may add a field without initializing it in the factory, not realizing the factory is the canonical reset point.

**Resolution:**  
T5 should include updating `apps/bot/src/index.ts` session initial factory:
```typescript
savedWordId: undefined,
```

---

### [MINOR-3] T4 Adds New i18n Keys Only to 3 Locales — Other 7 Supported Languages Undocumented

**Conflicting artifacts:** `@docs/tasks/30-save-to-dictionary.md` (T4) vs `packages/core/src/modules/i18n/types.ts` (`SupportedLang`)

**Mismatch:**  
T4 adds `saveWord` and `savePhrase` to `en.json`, `ru.json`, and `cs.json` only. However, `SupportedLang` includes 10 languages: `"en" | "ru" | "cs" | "de" | "fr" | "es" | "it" | "pt" | "uk" | "pl"`. The i18n system presumably falls back to English when a key is missing from a locale. This is not broken, but the behavior is undocumented in T4 and relies on an implicit convention.

Looking at the existing locale directory, only `en.json`, `ru.json`, and `cs.json` exist (confirmed by `ls` check). The other 7 supported languages have no locale files. This means the fallback behavior is the established pattern, but T4 should acknowledge it rather than implying incomplete i18n coverage.

**Impact:** No functional issue. The i18n fallback to English is correct behavior. The risk is that future tasks adding locale files for `de`, `fr`, etc. must remember to include `saveWord`/`savePhrase`.

**Resolution:**  
Add a note to T4: "Only en/ru/cs locale files exist. For all other `SupportedLang` values, the i18n system falls back to English. When additional locale files are created in future tasks, `saveWord` and `savePhrase` must be added to those files."

---

## Data Flow Completeness Check

| Flow | Status | Notes |
|------|--------|-------|
| User → Save button → `handleSaveCallback` | ✅ Complete | `bot.callbackQuery("tr:save", handleSaveCallback)` in `index.ts` |
| `handleSaveCallback` → FK resolution → `getLang()` | ✅ Complete | `getLang` exported from `@polyglot/adapter-db` |
| `handleSaveCallback` → dedup → `findByOriginalAndSource` | ✅ Complete | T3 adds the method |
| `handleSaveCallback` → sanitize → `sanitizeForStorage()` | ✅ Complete | T5 creates the utility |
| `handleSaveCallback` → persist → `wordRepository.create()` | ✅ Complete after T3+T7 |
| `handleSaveCallback` → session → `savedWordId` | ✅ Complete after T5+T7 |
| Regen on saved card → `updateContent` | ✅ Complete | T8 covers `handleRegenCallback` |
| New translation → session reset → `savedWordId = undefined` | ✅ Complete | T8 covers `handleTranslateText` |
| `lastInputType === 'sentence'` guard in save handler | ⚠️ **Missing** | See MAJOR-4 |
| `handleRegenLoop` save path → dedup + sanitize | ⚠️ **Dead code** | See CRITICAL-1 |
| `buildTranslationKeyboard` callers updated | ⚠️ **Ownership ambiguous** | See MAJOR-2 |

---

## API Contract Alignment Check

| Contract | Tech-Reqs | Tasks | Code (current) | Status |
|---------|-----------|-------|---------------|--------|
| `StoredWordContent` type | §3.1 | T2 | Not yet defined | ✅ Aligned (T2 will add) |
| `wordRepository.create(userId, CreateWordInput)` | §3.1 | T3 | `create(userId, Omit<NewWord,"userId">)` | ✅ Aligned (T3 will change) |
| `wordRepository.findByOriginalAndSource` | §3.1 | T3 | Not present | ✅ Aligned (T3 will add) |
| `wordRepository.updateContent(id, StoredWordContent)` | §3.1 | T3 | `updateContent(id, Record<string,unknown>)` | ✅ Aligned (T3 will update) |
| `buildTranslationKeyboard(codes, inputType, lang?)` | §3.2 | T6 | `buildTranslationKeyboard(codes, lang?)` | ✅ Aligned (T6 will change) |
| `buildPostSaveKeyboard(codes, lang?)` | §3.2 | T6 | Not present | ✅ Aligned (T6 will add) |
| `sanitizeForStorage(output) → StoredWordContent` | §3.2 | T5 | Not present | ✅ Aligned (T5 will add) |
| `saveWord`/`savePhrase` i18n keys | §3.3 | T4 | Not present in `I18nKey` | ⚠️ **Type name mismatch** (see MAJOR-1) |
| `SessionData.savedWordId` | §3.2 | T5 | Not present | ✅ Aligned (T5 will add) |
| Migration 0005 SQL | §6 | T1 | Not present (4 migrations exist) | ✅ Aligned (T1 will add) |

---

## Requirement Traceability Check

| Requirement | Task Coverage | Status |
|------------|--------------|--------|
| REQ-3001 Save trigger (inline button only) | T7 (handleSaveCallback full flow) | ✅ Covered |
| REQ-3002 sourceLangId FK | T1 (migration), T2 (schema), T3 (repository) | ✅ Covered |
| REQ-3003 inputType column | T1 (migration), T2 (schema), T3 (repository), T7 (save flow) | ✅ Covered |
| REQ-3004 Duplicate detection | T3 (findByOriginalAndSource), T7 (dedup step), T9 (regen.helper dead code) | ⚠️ T9 dedup is dead code (see CRITICAL-1) |
| REQ-3005 Content sanitization | T5 (sanitizeForStorage), T7 (save flow), T8 (regen update) | ✅ Covered |
| REQ-3006 Contextual button labels | T4 (i18n keys), T6 (keyboard builder) | ✅ Covered |
| REQ-3007 Post-save regen | T6 (buildPostSaveKeyboard), T7 (edit card), T8 (updateContent on regen) | ✅ Covered |
| REQ-3008 Migration 0005 | T1 | ✅ Covered |
| REQ-3009 findByOriginalAndSource method | T3 | ✅ Covered |
| REQ-3010 Input normalization | ⚠️ Deferred per PO (mvp-scope.md §2.1) | ✅ Explicitly deferred |
| US-3004 (saveWord/savePhrase labels) | T4, T6 | ⚠️ Type name mismatch (see MAJOR-1) |

Every Must-Have requirement maps to tasks. Every task maps to a requirement or explicit architecture decision. No orphaned tasks found.

---

## Error Handling Coverage

| Failure Mode | Handling | Source |
|-------------|----------|--------|
| `pendingTranslation` undefined on save | Early return + `answerCallbackQuery()` | T7 Step 1 |
| `getLang()` returns null (unknown sourceLang) | Log error + `translationError` toast | T7 Step 2 |
| Duplicate detected | `alreadySaved` toast (`show_alert: true`) + return | T7 Step 3 |
| DB insert fails (race condition duplicate) | DB constraint → exception. **Not caught in T7.** | ⚠️ Missing |
| `editMessageText` fails (message too old) | Caught and logged; save still succeeds | T7 note |
| `updateContent` fails on regen | Caught and logged; regen still re-renders | T8 |
| `lastInputType === 'sentence'` at save time | **Not handled** — violates architecture constraint | ⚠️ See MAJOR-4 |
| `wordRepository.create()` throws (network/DB) | **Not explicitly caught in T7.** Falls to outer bot.catch() | ⚠️ Minor gap |

**Note:** The DB unique constraint violation (race condition where two simultaneous taps both pass the app-level dedup check) is not explicitly caught in T7. The exception would propagate to the bot's global error handler. Recommend wrapping the `wordRepository.create()` call in T7 to catch unique constraint violations specifically and return an `alreadySaved` toast instead of a generic error.

---

## DB-SOT Compliance

| Check | Status |
|-------|--------|
| `sourceLangId` FK to `languages(id)` — not hardcoded string | ✅ Compliant (T2/T3) |
| `inputType` TEXT+CHECK (not enum) — consistent with `activeMode` pattern | ✅ Compliant (T1/T2) |
| Language codes in `translations` JSONB keys validated against language cache | ✅ Compliant (PO C2: validated at write time) |
| Backfill uses `JOIN languages ON code = source_lang` — not hardcoded codes | ✅ Compliant (T1 Step 3) |
