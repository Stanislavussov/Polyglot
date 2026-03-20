---
name: topics
description: Topic management with built-in datasets, cache-first translation, and custom topic generation. Provides getBuiltinTopics(), getTopicWords(), generateCustomTopic(), and cache status. Use when implementing or modifying topic-related features, dataset loading, or translation caching.
---

# topics Agent Skill

## Module Location

`packages/core/src/modules/topics/` — platform-independent core module.

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `translation` agent (for batch translation via injected `translateBatch`), `db` agent (for cache via injected `getCached`/`setCached`). Dictionary context enrichment is now handled by the context-enrichment layer — callers should inject context-enriched `translateBatch`/`translateOne` functions.
- **Dependents:** `notifications` agent (picks words from topics), `bot` agent (displays topics)
- **Injection:** All adapter dependencies (db, ai) are injected via `TopicDeps` — core never imports adapters directly.

## Current State

Fully implemented with partial regeneration, idiomatic equivalent passthrough, and translation alternatives support. After Task 15 (context-enrichment layer), dictionary context lookup was removed from `TopicDeps` — the `lookupDictionaryContext` dep and internal `lookupContextsBatch` helper are gone. Callers should now inject context-enriched `translateBatch`/`translateOne` functions (e.g., wrapping `translateBatchWithContext`/`translateOneWithContext` from the context-enrichment module). The `LanguageTranslationEntry` type includes optional `expressionType`, `equivalentNote`, and `alternatives` fields. The `TopicTranslationVariant` type mirrors the translation module's `TranslationVariant` for decoupled alternative translation storage. All public API functions working with 65 tests passing.

## Rules

1. Always checks cache before calling the `translation` agent
2. Calls `translation` in batch only — never one word at a time
3. Knows nothing about the user — works with language pairs
4. Built-in datasets are loaded once at startup
5. Dictionary context enrichment is handled externally via context-enrichment layer — not in topics service

## Built-in Datasets

JSON files in `packages/core/src/modules/topics/datasets/`:
- `food.json` — 25 food & cooking vocabulary words
- `travel.json` — 25 travel & transportation words
- `it-terms.json` — 25 IT & programming terms

Each dataset:
```json
{
  "id": "food",
  "name": "Food & Cooking",
  "emoji": "🍳",
  "words": ["apple", "bread", "butter", "cheese", ...]
}
```

## Public API

### Pure functions (no dependencies)

```typescript
// List all built-in topics (metadata only, no translations)
function getBuiltinTopics(): TopicMeta[];

// Get raw dataset by topic ID (internal helper, also exported)
function getDataset(topicId: string): TopicDataset | undefined;
```

### Service factory (requires injected dependencies)

```typescript
// Create a topic service with injected dependencies
function createTopicService(deps: TopicDeps): {
  getTopicWords: (topicId: string, sourceLang: string, targetLangs: string[]) => Promise<TopicWord[]>;
  generateCustomTopic: (prompt: string, sourceLang: string, targetLangs: string[]) => Promise<Topic>;
  getCacheStatus: (topicId: string, sourceLang: string, targetLangs: string[]) => Promise<CacheStatus>;
  regenerateTopicWord: (topicId: string, original: string, sourceLang: string, targetLang: string) => Promise<LanguageTranslationEntry>;
};
```

### Dependency Injection

```typescript
interface TopicDeps {
  // Batch translate words — callers should inject a context-enriched function
  // (e.g., wrapping translateBatchWithContext from the context-enrichment module)
  translateBatch: (
    words: string[],
    sourceLang: string,
    targetLangs: string[],
  ) => Promise<TranslateOutput[]>;
  // Single-language translation for partial regeneration (optional)
  // Callers should inject a context-enriched function
  translateOne?: (
    word: string,
    sourceLang: string,
    targetLang: string,
  ) => Promise<LanguageTranslationEntry>;
  // Cache read (from db topicRepository.getCached)
  getCached: (topicId: string, original: string, sourceLang: string, targetLang: string) => Promise<CachedTranslation | null>;
  // Cache write (from db topicRepository.setCached)
  setCached: (data: NewCachedTranslation) => Promise<unknown>;
  // Optional: generate word list via AI (for custom topics)
  generateWords?: (prompt: string) => Promise<{ name: string; emoji: string; words: string[] }>;
}
```

## Types

```typescript
/** Whether a translation is literal or an idiomatic equivalent (mirrors translation module) */
type TopicExpressionType = "literal" | "idiomatic_equivalent";

/** An alternative translation variant with its own register and synonyms (mirrors translation module) */
interface TopicTranslationVariant {
  text: string;
  register: string;
  synonyms: Array<{ text: string; register: string }>;
}

interface TopicMeta {
  id: string;
  name: string;
  emoji: string;
  wordCount: number;
}

interface LanguageTranslationEntry {
  text: string;
  cefr: string;
  transcription?: string;
  register: string;
  synonyms: Array<{ text: string; register: string }>;
  examples: Array<{ context: string; target: string; native: string }>;
  /** Signals whether the translation is literal or an idiomatic equivalent */
  expressionType?: TopicExpressionType;
  /** Short note in the source language explaining why an equivalent was chosen */
  equivalentNote?: string;
  /** Up to 2 alternative translation variants, each with its own register and synonyms */
  alternatives?: TopicTranslationVariant[];
}

interface TopicWord {
  original: string;
  translations: Record<string, LanguageTranslationEntry>;
}

interface Topic {
  meta: TopicMeta;
  words: TopicWord[];
}

interface CacheStatus {
  total: number;
  cached: number;
  missing: number;
  status: "hit" | "miss" | "partial";
}

interface TopicDataset {
  id: string;
  name: string;
  emoji: string;
  words: string[];
}
```

## Dictionary Context Integration

After Task 15, dictionary context lookup is **no longer done inside the topics service**. Context enrichment is handled externally by the context-enrichment layer (`translateWithContext`, `translateBatchWithContext` from `@polyglot/core`).

Callers inject context-enriched `translateBatch`/`translateOne` functions into `TopicDeps`:
- `translateBatch` is called with 3 args: `(words, sourceLang, targetLangs)` — no `dictionaryContexts` map
- `translateOne` is called with 3 args: `(word, sourceLang, targetLang)` — no `dictionaryContext`

### Data flow
```
Bot layer
  └── injects translateBatch (wrapping translateBatchWithContext with model/generateObjectFn/lookupContext)
  └── injects translateOne (wrapping translateOneWithContext with model/generateObjectFn/lookupContext)
    └── Topics service
        ├── Checks cache first
        ├── Calls injected translateBatch/translateOne (context enrichment happens inside)
        └── Caches results
```

## Cache Strategy

- **Cache key:** `(topicId, original, sourceLang, targetLang)` — one row per word × language
- **Cache check:** For each word, check ALL target languages. Word is "cached" only when ALL langs have entries.
- **On miss:** Batch translate ALL uncached words in a single `translateBatch` call (context enrichment handled by injected function), then store results per-language in cache.
- **On partial regeneration:** `regenerateTopicWord` re-translates a single language for a topic word via `translateOne` (context enrichment handled by injected function), then overwrites the cache entry for that word+lang.
- **Shared:** Cache is shared across users with the same language pair — not per user.

## File Structure

```
packages/core/src/modules/topics/
├── index.ts              # Re-exports public API (incl. TopicExpressionType, TopicTranslationVariant)
├── types.ts              # TopicMeta, TopicWord, Topic, CacheStatus, TopicDeps, TopicExpressionType, TopicTranslationVariant
├── topic.service.ts      # getBuiltinTopics, createTopicService (factory)
├── datasets/
│   ├── food.json         # 25 food & cooking words
│   ├── travel.json       # 25 travel & transport words
│   └── it-terms.json     # 25 IT & tech words
└── __tests__/
    ├── topic.service.test.ts       # 37 tests (27 original + 10 regenerateTopicWord)
    ├── idiomatic-equivalents.test.ts  # 10 tests for idiomatic field passthrough
    ├── dictionary-context.test.ts  # 8 tests for post-context-enrichment translation integration
    └── alternatives.test.ts        # 10 tests for translation alternatives passthrough
```

## Usage Example

```typescript
import {
  getBuiltinTopics,
  createTopicService,
  translateBatchWithContext,
  translateOneWithContext,
} from "@polyglot/core";
import { topicRepository, createContextLookup } from "@polyglot/db";
import { generateObject } from "@polyglot/adapter-ai";

// List topics (no deps needed)
const topics = getBuiltinTopics();

const lookupContext = createContextLookup();
const enrichmentDeps = { lookupContext, generateObjectFn: generateObject };

// Create service with context-enriched translate functions
const service = createTopicService({
  translateBatch: (words, src, tgt) =>
    translateBatchWithContext(words, src, tgt, model, enrichmentDeps),
  translateOne: (word, src, tgt) =>
    translateOneWithContext(
      { word, sourceLang: src, targetLangs: [tgt], targetLang: tgt, model },
      enrichmentDeps,
    ),
  getCached: topicRepository.getCached,
  setCached: topicRepository.setCached,
});

// Get translated words (cache-first, with Wiktionary enrichment via context-enrichment layer)
const words = await service.getTopicWords("food", "en", ["cs", "de"]);

// Regenerate a single language (context enrichment handled by injected translateOne)
const newCsTranslation = await service.regenerateTopicWord("food", "apple", "en", "cs");
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (topics section)
- BRD: `docs/BRD.md` § Post-MVP 2.2 (Ready-Made Topic Sets)
- Task 13: `docs/tasks/13-wiktionary-jsonl.md` (Wiktionary JSONL Integration)
