# Task 15: Context Enrichment Layer (Pre-AI Dictionary Lookup)

**Status:** ✅ Done

## Description

Create an **isolated, testable context enrichment layer** that sits between translation callers and the AI adapter. Before every AI translation request, this layer queries the `word_context` table in the database, retrieves offline dictionary data (Wiktionary glosses, POS, form tags), merges the retrieved context into the translation prompt, and passes the enriched prompt to the AI.

Currently, dictionary context lookup is duplicated across **three consumers** (bot `translate-mode.helper`, topics `topic.service`, notifications `notification.service`). Each consumer independently calls `wordContextRepository.findByWordAndLangCode()`, transforms the result to `DictionaryContext`, and injects it into the `translate()` call. This violates DRY, makes testing harder, and means any new consumer must re-implement the same lookup + fail-open + transformation logic.

This task extracts that concern into a single, isolated module with its own interface — testable in unit tests with mocked dependencies, usable as a standalone subagent target.

**References:**
- `@docs/tech-reqs/02-architecture.md` (layer separation)
- `@docs/tech-reqs/04-adapter-contract.md` (adapter contracts)
- `@docs/tasks/13-wiktionary-jsonl.md` (Wiktionary integration, `word_context` schema)
- `.pi/skills/translation/SKILL.md` (translation flow, `DictionaryContext` type)
- `.pi/skills/db/SKILL.md` (`WordContextRepository` API)

## Problem Statement

```
CURRENT FLOW (duplicated lookup in every consumer):

  bot/translate-mode.helper ─────┐
                                 ├─→ wordContextRepository.findByWordAndLangCode()
  topics/topic.service ──────────┤    → transform to DictionaryContext
                                 │    → pass to translate()
  notifications/notification ────┘

DESIRED FLOW (single enrichment layer):

  bot / topics / notifications
         │
         ▼
  ┌─────────────────────────────────┐
  │   context-enrichment layer      │  ← NEW isolated module
  │                                 │
  │  1. Receive word + sourceLang   │
  │  2. Query word_context table    │
  │  3. Transform → DictionaryCtx  │
  │  4. Merge context into prompt   │
  │  5. Call AI via generateObjectFn│
  │  6. Return TranslateOutput      │
  └─────────────────────────────────┘
```

## Architecture Decision

### Option A — Core module wrapping `translate()` (CHOSEN)

Place in `packages/core/src/modules/context-enrichment/`. The module receives a **lookup function** via dependency injection (same pattern as `generateObjectFn` in the translation service). It never imports DB directly — keeping core platform-independent.

**Why this option:**
- Core layer = platform-independent, unit-testable with mocks
- Follows the existing DI pattern (`generateObjectFn`, `lookupDictionaryContext` in topics)
- Clean subagent boundary — one module, one responsibility
- Consumers just call `translateWithContext()` instead of `translate()` + manual lookup

### Option B — Adapter-level middleware (rejected)

Would break the "adapters don't import core" constraint and make testing harder.

## Subtasks

### Step 1: Define Types & Interface

- [x] Create `packages/core/src/modules/context-enrichment/types.ts`:
  - `ContextLookupFn` — `(word: string, langCode: string) => Promise<DictionaryContext | undefined>`
  - `ContextEnrichmentDeps` — `{ lookupContext: ContextLookupFn; generateObjectFn: GenerateObjectFn }`
  - `EnrichedTranslateInput` — extends `TranslateInput`, omits `dictionaryContext` (the layer fills it)
  - Re-use `DictionaryContext` from `packages/core/src/modules/translation/types.ts` (no duplication)

### Step 2: Implement Context Enrichment Service

- [x] Create `packages/core/src/modules/context-enrichment/context-enrichment.service.ts`:
  - `translateWithContext(input: EnrichedTranslateInput, deps: ContextEnrichmentDeps): Promise<TranslateOutput>`
    1. Call `deps.lookupContext(input.word, input.sourceLang)` — fail-open (catch → `undefined`)
    2. Build full `TranslateInput` with `dictionaryContext` field populated from lookup
    3. Call `translate(fullInput, deps.generateObjectFn)` from translation module
    4. Return `TranslateOutput` as-is
  - `translateOneWithContext(input: EnrichedTranslateInput & { targetLang: string }, deps: ContextEnrichmentDeps): Promise<LanguageTranslation>`
    1. Same lookup pattern as above
    2. Delegates to `translateOne()` from translation module
  - `translateBatchWithContext(words: string[], sourceLang: string, targetLangs: string[], model: string, deps: ContextEnrichmentDeps): Promise<TranslateOutput[]>`
    1. For each word: lookup context, then translate
    2. Sequential (same as existing `translateBatch` — no parallel to avoid rate limits)
  - All functions are **pure** (no side effects beyond the injected deps) — fully testable with mocks

### Step 3: Create Barrel Export

- [x] Create `packages/core/src/modules/context-enrichment/index.ts`:
  - Re-export `translateWithContext`, `translateOneWithContext`, `translateBatchWithContext`
  - Re-export types: `ContextLookupFn`, `ContextEnrichmentDeps`, `EnrichedTranslateInput`
- [x] Update `packages/core/src/index.ts` to re-export the context-enrichment public API

### Step 4: Create `ContextLookupFn` Factory in DB Adapter

- [x] Create `packages/adapters/db/src/context-lookup.ts`:
  - `createContextLookup(): ContextLookupFn` — factory that returns a function wrapping `wordContextRepository.findByWordAndLangCode()` + transform to `DictionaryContext`
  - This is the **single place** where DB → `DictionaryContext` transformation happens
  - Fail-open built into the factory (catches errors, returns `undefined`)
- [x] Update `packages/adapters/db/src/index.ts` to re-export `createContextLookup`

### Step 5: Write Tests

- [x] Create `packages/core/src/modules/context-enrichment/__tests__/context-enrichment.service.test.ts`:
  - Test: `translateWithContext` calls lookup, merges context, calls translate
  - Test: lookup returns context → `dictionaryContext` is set on translate input
  - Test: lookup returns `undefined` → translate called without `dictionaryContext`
  - Test: lookup throws → fail-open, translate called without `dictionaryContext`
  - Test: `translateOneWithContext` — same pattern, delegates to `translateOne`
  - Test: `translateBatchWithContext` — calls lookup per word, sequential
  - Test: all deps are injected — no real DB or AI calls in tests
  - Actual: 21 tests
- [x] Create `packages/adapters/db/src/__tests__/context-lookup.test.ts`:
  - Test: `createContextLookup` returns function
  - Test: function calls `findByWordAndLangCode` and transforms result
  - Test: no results → returns `undefined`
  - Test: repository throws → returns `undefined` (fail-open)
  - Actual: 9 tests

### Step 6: Migrate Consumers to Use Context Enrichment Layer

- [x] `apps/bot/src/scenes/helpers/translate-mode.helper.ts`:
  - Remove `lookupDictContext()` function
  - Replace `translate()` call with `translateWithContext()` from the new module
  - Pass `createContextLookup()` and `generateObject` as deps
- [x] `packages/core/src/modules/topics/topic.service.ts`:
  - Remove `lookupContextsBatch` internal helper
  - Remove `lookupDictionaryContext` from `TopicDeps`
  - Simplified `translateBatch`/`translateOne` signatures — callers inject context-enriched functions
- [x] `packages/adapters/notifications/src/notification.service.ts`:
  - Remove `lookupDictionaryContext` from `NotificationServiceDeps`
  - Removed dictionary context lookup — handled at translation level
- [x] Update all affected tests to use the new API

### Step 7: Update Skills

- [x] Create `.pi/skills/context-enrichment/SKILL.md` — new skill for the context enrichment layer
- [x] Update `.pi/skills/translation/SKILL.md` — note that `dictionaryContext` is now managed by the enrichment layer
- [x] Update `.pi/skills/bot/SKILL.md` — update translate-mode helper docs
- [x] Update `.pi/skills/topics/SKILL.md` — remove `lookupDictionaryContext` from deps
- [x] Update `.pi/skills/notifications/SKILL.md` — remove `lookupDictionaryContext` from deps

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Core module, not adapter | Core is platform-independent; DB access injected via `ContextLookupFn` |
| Dependency injection for lookup | Same pattern as `generateObjectFn` — keeps core testable without DB |
| Fail-open at two levels | Factory fail-open (DB errors) + service fail-open (lookup returns `undefined`) |
| Sequential batch | Matches existing `translateBatch` — avoids AI rate limits |
| Single `createContextLookup` factory | One place for DB → `DictionaryContext` transform, shared by all consumers |
| `EnrichedTranslateInput` omits `dictionaryContext` | Callers don't set it — the layer fills it. Prevents accidental double-lookup |

## Files Created / Modified

### Created
- `packages/core/src/modules/context-enrichment/types.ts`
- `packages/core/src/modules/context-enrichment/context-enrichment.service.ts`
- `packages/core/src/modules/context-enrichment/index.ts`
- `packages/core/src/modules/context-enrichment/__tests__/context-enrichment.service.test.ts`
- `packages/adapters/db/src/context-lookup.ts`
- `packages/adapters/db/src/__tests__/context-lookup.test.ts`
- `.pi/skills/context-enrichment/SKILL.md`

### Modified
- `packages/core/src/index.ts` — re-export context-enrichment API
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — use `translateWithContext()`, remove `lookupDictContext()`
- `apps/bot/src/scenes/helpers/translate-mode.helper.test.ts` — update to new API
- `packages/core/src/modules/topics/types.ts` — remove `lookupDictionaryContext` from `TopicDeps`
- `packages/core/src/modules/topics/topic.service.ts` — use `translateBatchWithContext()` / `translateOneWithContext()`
- `packages/core/src/modules/topics/__tests__/dictionary-context.test.ts` — update to new API
- `packages/adapters/notifications/src/types.ts` — remove `lookupDictionaryContext` from deps
- `packages/adapters/notifications/src/notification.service.ts` — use `translateWithContext()`
- `packages/adapters/notifications/src/dictionary-context.test.ts` — update to new API
- `packages/adapters/db/src/index.ts` — re-export `createContextLookup`
- `.pi/skills/translation/SKILL.md` — update docs
- `.pi/skills/bot/SKILL.md` — update docs
- `.pi/skills/topics/SKILL.md` — update docs
- `.pi/skills/notifications/SKILL.md` — update docs

## Data Flow Diagram

```
                    Consumer (bot / topics / notifications)
                              │
                              │  word, sourceLang, targetLangs, model
                              ▼
              ┌───────────────────────────────────┐
              │    context-enrichment.service      │
              │                                   │
              │   translateWithContext(input, deps)│
              │           │                       │
              │     ┌─────▼──────┐                │
              │     │  deps.     │                │
              │     │  lookup    │  (ContextLookupFn)
              │     │  Context() │──── DB adapter ──→ word_context table
              │     └─────┬──────┘                │
              │           │ DictionaryContext?     │
              │     ┌─────▼──────┐                │
              │     │  merge     │                │
              │     │  context   │                │
              │     │  into      │                │
              │     │  input     │                │
              │     └─────┬──────┘                │
              │           │ TranslateInput         │
              │     ┌─────▼──────┐                │
              │     │ translate()│ (core module)   │
              │     └─────┬──────┘                │
              │           │                       │
              │           ▼                       │
              │   prompt builder enriches with    │
              │   dictionary context → AI call    │
              └───────────────┬───────────────────┘
                              │
                              ▼
                       TranslateOutput
```

## Acceptance Criteria

- [x] New `context-enrichment` module exists in `packages/core/src/modules/context-enrichment/`
- [x] `translateWithContext()` is the single entry point — callers never query `word_context` directly
- [x] Module is **fully isolated** — zero imports from `@polyglot/adapter-db` or `@polyglot/adapter-ai` in core
- [x] All dependencies injected via `ContextEnrichmentDeps` (lookup + generateObject)
- [x] Fail-open: DB errors or empty results do NOT break translation — AI is called without context
- [x] `createContextLookup()` factory in DB adapter is the single DB → `DictionaryContext` transform
- [x] All 3 consumers (bot, topics, notifications) migrated — no direct `wordContextRepository` usage for translation enrichment
- [x] Existing `lookupDictContext` (bot), `lookupContextsBatch` (topics), and `lookupDictionaryContext` (notifications) are removed
- [x] 21 unit tests for context-enrichment service (mocked deps, no real DB/AI) — exceeds 15+ target
- [x] 9 unit tests for `createContextLookup` factory — exceeds 6+ target
- [x] All existing tests pass after migration (`pnpm test`) — 617 tests passing
- [x] All packages build (`pnpm -r run build`)
- [x] New `.pi/skills/context-enrichment/SKILL.md` created and all affected skills updated
