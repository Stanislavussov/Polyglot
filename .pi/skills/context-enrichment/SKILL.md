---
name: context-enrichment
description: Pre-AI dictionary context lookup layer. Enriches translation inputs with Wiktionary dictionary context before calling the AI. Provides translateWithContext, translateOneWithContext, translateBatchWithContext as drop-in replacements for translate/translateOne/translateBatch. Use when implementing or modifying context-enriched translation, dictionary lookup integration, or pre-AI enrichment.
---

# Context Enrichment Agent Skill

## Module Location

`packages/core/src/modules/context-enrichment/`

## Architecture Context

- **Layer:** Core (platform-independent, no I/O)
- **Dependencies:** Translation module (`translate`, `translateOne` from `packages/core/src/modules/translation/`)
- **Dependents:** Bot (`translate-mode.helper`), Topics (via injected `translateBatch`/`translateOne`), Notifications (via injected topic service)
- **DB Adapter Factory:** `packages/adapters/db/src/context-lookup.ts` — `createContextLookup()` wraps `wordContextRepository`

## Current State

Fully implemented (Task 15). The context enrichment layer sits between translation callers and the AI adapter. It:
1. Queries dictionary context via injected `ContextLookupFn`
2. Merges retrieved context into the translation input
3. Calls `translate()` / `translateOne()` from the translation module

All 3 consumers migrated:
- Bot `translate-mode.helper` uses `translateWithContext()`
- Topics service receives context-enriched `translateBatch`/`translateOne` via DI
- Notifications service no longer does dictionary lookup (handled at translation level)

## Boundary

- **Mode:** role — when this skill is active, you ARE the context-enrichment agent. Only modify the enrichment module and its DB adapter factory.
- **Produces:** enrichment source code and tests in `packages/core/src/modules/context-enrichment/` and `packages/adapters/db/src/context-lookup.ts`
- **Never:** modify code outside `packages/core/src/modules/context-enrichment/` and `packages/adapters/db/src/context-lookup.ts`
- **Never:** import DB or AI adapters directly from core — all dependencies injected
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/core/src/modules/context-enrichment/**`, `packages/adapters/db/src/context-lookup.ts`, `packages/adapters/db/src/__tests__/context-lookup.test.ts`

## Rules

1. Core module — never imports DB or AI adapters directly
2. Dictionary context lookup is injected via `ContextLookupFn`
3. Fail-open: lookup errors return `undefined`, translation proceeds without context
4. Sequential batch processing to avoid AI rate limits
5. `EnrichedTranslateInput` omits `dictionaryContext` — the layer fills it
6. `createContextLookup()` in DB adapter is the single DB → DictionaryContext transform

## Skills (Public API)

```typescript
// Translate with automatic dictionary context enrichment
function translateWithContext(
  input: EnrichedTranslateInput,
  deps: ContextEnrichmentDeps,
): Promise<TranslateOutput>;

// Re-translate a single target language with context enrichment
function translateOneWithContext(
  input: EnrichedTranslateInput & { targetLang: string },
  deps: ContextEnrichmentDeps,
): Promise<LanguageTranslation>;

// Batch translate with per-word context enrichment (sequential)
function translateBatchWithContext(
  words: string[],
  sourceLang: string,
  targetLangs: string[],
  model: string,
  deps: ContextEnrichmentDeps,
): Promise<TranslateOutput[]>;

// DB adapter factory (in @polyglot/adapter-db)
function createContextLookup(): ContextLookupFn;
```

## Types

```typescript
// Lookup function — injected from DB adapter
type ContextLookupFn = (
  word: string,
  langCode: string,
) => Promise<DictionaryContext | undefined>;

// Dependencies for the enrichment layer
interface ContextEnrichmentDeps {
  lookupContext: ContextLookupFn;
  generateObjectFn: GenerateObjectFn;
}

// Input without dictionaryContext (layer fills it)
type EnrichedTranslateInput = Omit<TranslateInput, "dictionaryContext">;
```

## File Structure

```
packages/core/src/modules/context-enrichment/
├── index.ts                           # Barrel export
├── types.ts                           # ContextLookupFn, ContextEnrichmentDeps, EnrichedTranslateInput
├── context-enrichment.service.ts      # translateWithContext, translateOneWithContext, translateBatchWithContext
└── __tests__/
    └── context-enrichment.service.test.ts  # 21 tests

packages/adapters/db/src/
├── context-lookup.ts                  # createContextLookup() factory
└── __tests__/
    └── context-lookup.test.ts         # 9 tests
```

## Sentence Input Skip (Task 27)

The context-enrichment module itself is **not aware of input types** (word/phrase/sentence). Sentence-type inputs should **not** receive Wiktionary dictionary context (no learnable word to enrich). This skip is handled at the **caller level** — the bot's `translate-mode.helper.ts` passes a no-op `lookupContext` function (`async () => undefined`) when `classifyInput()` returns `type: 'sentence'`. The enrichment module processes it normally, receiving `undefined` from the no-op lookup, and translation proceeds without dictionary context. This approach keeps the enrichment layer simple and unaware of input classification.

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Task 15: `docs/tasks/15-context-enrichment-layer.md`
- Translation skill: `.pi/skills/translation/SKILL.md`
- DB skill: `.pi/skills/db/SKILL.md`
