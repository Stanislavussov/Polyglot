---
name: topics
description: Topic management with built-in datasets, cache-first translation, and custom topic generation. Provides getBuiltinTopics(), getTopicWords(), generateCustomTopic(), and cache status. Use when implementing or modifying topic-related features, dataset loading, or translation caching.
---

# topics Agent Skill

## Module Location

`packages/core/src/modules/topics/` — platform-independent core module.

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `translation` agent (for batch translation via injected `translateBatch`), `db` agent (for cache via injected `getCached`/`setCached`, for dictionary context via injected `lookupDictionaryContext`)
- **Dependents:** `notifications` agent (picks words from topics), `bot` agent (displays topics)
- **Injection:** All adapter dependencies (db, ai) are injected via `TopicDeps` — core never imports adapters directly.

## Current State

Fully implemented with partial regeneration, idiomatic equivalent passthrough, and Wiktionary dictionary context integration. The `TopicDeps` interface supports an optional `lookupDictionaryContext` dependency for enriching translations with offline Wiktionary data. Dictionary contexts are looked up in batch for uncached words (via `Promise.allSettled` for fail-open resilience) and passed through to `translateBatch`/`translateOne`. The `LanguageTranslationEntry` type includes optional `expressionType` and `equivalentNote` fields. All public API functions working with 67 tests passing (27 original + 10 for regenerateTopicWord + 10 for idiomatic equivalents + 20 for dictionary context).

## Rules

1. Always checks cache before calling the `translation` agent
2. Calls `translation` in batch only — never one word at a time
3. Knows nothing about the user — works with language pairs
4. Built-in datasets are loaded once at startup
5. Dictionary context lookup is fail-open — errors are swallowed, translation proceeds without context
6. Dictionary contexts are looked up in parallel for performance

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
  // Batch translate words (from translation module, pre-bound with model + generateObjectFn)
  translateBatch: (
    words: string[],
    sourceLang: string,
    targetLangs: string[],
    dictionaryContexts?: Map<string, DictionaryContext>,
  ) => Promise<TranslateOutput[]>;
  // Single-language translation for partial regeneration (optional, pre-bound with model + generateObjectFn)
  translateOne?: (
    word: string,
    sourceLang: string,
    targetLang: string,
    dictionaryContext?: DictionaryContext,
  ) => Promise<LanguageTranslationEntry>;
  // Cache read (from db topicRepository.getCached)
  getCached: (topicId: string, original: string, sourceLang: string, targetLang: string) => Promise<CachedTranslation | null>;
  // Cache write (from db topicRepository.setCached)
  setCached: (data: NewCachedTranslation) => Promise<unknown>;
  // Optional: generate word list via AI (for custom topics)
  generateWords?: (prompt: string) => Promise<{ name: string; emoji: string; words: string[] }>;
  // Optional: look up Wiktionary dictionary context for a word (from db wordContextRepository)
  lookupDictionaryContext?: (word: string, langCode: string) => Promise<DictionaryContext | null>;
}
```

## Types

```typescript
/** Whether a translation is literal or an idiomatic equivalent (mirrors translation module) */
type TopicExpressionType = "literal" | "idiomatic_equivalent";

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

When `lookupDictionaryContext` is injected:

1. **getTopicWords**: After identifying uncached words, looks up Wiktionary context for each uncached word in parallel. Passes the `Map<string, DictionaryContext>` to `translateBatch` as the 4th argument (only when at least one context is found).
2. **regenerateTopicWord**: Looks up context for the word before calling `translateOne`. Passes context as the 4th argument when available.
3. **generateCustomTopic**: Looks up context for AI-generated words before batch translating.

### Fail-open design
- Dictionary lookups use `Promise.allSettled` — individual lookup failures don't prevent translation.
- `regenerateTopicWord` wraps the lookup in `.catch(() => null)`.
- When no contexts are found (all null or all failed), `translateBatch` is called with only 3 arguments (backward compatible).

### Data flow
```
Bot layer
  └── injects lookupDictionaryContext (backed by wordContextRepository.findByWordAndLangCode)
  └── injects translateBatch (backed by translation.translateBatch with model/generateObjectFn)
    └── Topics service
        ├── Checks cache first
        ├── Looks up Wiktionary context for uncached words (parallel, fail-open)
        ├── Passes contexts to translateBatch → translate() → prompt builder
        └── Caches results
```

## Cache Strategy

- **Cache key:** `(topicId, original, sourceLang, targetLang)` — one row per word × language
- **Cache check:** For each word, check ALL target languages. Word is "cached" only when ALL langs have entries.
- **On miss:** Batch translate ALL uncached words in a single `translateBatch` call (with optional dictionary context), then store results per-language in cache.
- **On partial regeneration:** `regenerateTopicWord` re-translates a single language for a topic word via `translateOne` (with optional dictionary context), then overwrites the cache entry for that word+lang.
- **Shared:** Cache is shared across users with the same language pair — not per user.

## File Structure

```
packages/core/src/modules/topics/
├── index.ts              # Re-exports public API (incl. TopicExpressionType)
├── types.ts              # TopicMeta, TopicWord, Topic, CacheStatus, TopicDeps, TopicExpressionType
├── topic.service.ts      # getBuiltinTopics, createTopicService (factory), lookupContextsBatch helper
├── datasets/
│   ├── food.json         # 25 food & cooking words
│   ├── travel.json       # 25 travel & transport words
│   └── it-terms.json     # 25 IT & tech words
└── __tests__/
    ├── topic.service.test.ts       # 37 tests (27 original + 10 regenerateTopicWord)
    ├── idiomatic-equivalents.test.ts  # 10 tests for idiomatic field passthrough
    └── dictionary-context.test.ts  # 20 tests for Wiktionary dictionary context integration
```

## Usage Example

```typescript
import { getBuiltinTopics, createTopicService } from "@polyglot/core";
import { topicRepository, wordContextRepository, languageRepository } from "@polyglot/db";
import { translateBatch } from "@polyglot/core";
import type { DictionaryContext } from "@polyglot/core";

// List topics (no deps needed)
const topics = getBuiltinTopics();

// Create service with injected deps (including dictionary context)
const service = createTopicService({
  translateBatch: (words, src, tgt, ctxs) =>
    translateBatch(words, src, tgt, model, generateObjectFn, ctxs),
  translateOne: (word, src, tgt, ctx) =>
    translateOne({ word, sourceLang: src, targetLangs: [tgt], targetLang: tgt, model, dictionaryContext: ctx }, generateObjectFn),
  getCached: topicRepository.getCached,
  setCached: topicRepository.setCached,
  lookupDictionaryContext: async (word, langCode) => {
    const entry = await wordContextRepository.findByWordAndLangCode(word, langCode);
    if (!entry) return null;
    return { word: entry.word, pos: entry.pos, glosses: entry.glosses, formTags: entry.formTags, langCode };
  },
});

// Get translated words (cache-first, with Wiktionary enrichment)
const words = await service.getTopicWords("food", "en", ["cs", "de"]);

// Regenerate a single language (with dictionary context)
const newCsTranslation = await service.regenerateTopicWord("food", "apple", "en", "cs");
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (topics section)
- BRD: `docs/BRD.md` § Post-MVP 2.2 (Ready-Made Topic Sets)
- Task 13: `docs/tasks/13-wiktionary-jsonl.md` (Wiktionary JSONL Integration)
