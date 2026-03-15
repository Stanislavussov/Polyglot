---
name: topics
description: Topic management with built-in datasets, cache-first translation, and custom topic generation. Provides getBuiltinTopics(), getTopicWords(), generateCustomTopic(), and cache status. Use when implementing or modifying topic-related features, dataset loading, or translation caching.
---

# topics Agent Skill

## Module Location

`packages/core/src/modules/topics/` — platform-independent core module.

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `translation` agent (for batch translation via injected `translateBatch`), `db` agent (for cache via injected `getCached`/`setCached`)
- **Dependents:** `notifications` agent (picks words from topics), `bot` agent (displays topics)
- **Injection:** All adapter dependencies (db, ai) are injected via `TopicDeps` — core never imports adapters directly.

## Current State

Fully implemented. All public API functions working with 27 tests passing.

## Rules

1. Always checks cache before calling the `translation` agent
2. Calls `translation` in batch only — never one word at a time
3. Knows nothing about the user — works with language pairs
4. Built-in datasets are loaded once at startup

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
};
```

### Dependency Injection

```typescript
interface TopicDeps {
  // Batch translate words (from translation module, pre-bound with model + generateObjectFn)
  translateBatch: (words: string[], sourceLang: string, targetLangs: string[]) => Promise<TranslateOutput[]>;
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
interface TopicMeta {
  id: string;
  name: string;
  emoji: string;
  wordCount: number;
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

## Cache Strategy

- **Cache key:** `(topicId, original, sourceLang, targetLang)` — one row per word × language
- **Cache check:** For each word, check ALL target languages. Word is "cached" only when ALL langs have entries.
- **On miss:** Batch translate ALL uncached words in a single `translateBatch` call, then store results per-language in cache.
- **Shared:** Cache is shared across users with the same language pair — not per user.

## File Structure

```
packages/core/src/modules/topics/
├── index.ts              # Re-exports public API
├── types.ts              # TopicMeta, TopicWord, Topic, CacheStatus, TopicDeps
├── topic.service.ts      # getBuiltinTopics, createTopicService (factory)
├── datasets/
│   ├── food.json         # 25 food & cooking words
│   ├── travel.json       # 25 travel & transport words
│   └── it-terms.json     # 25 IT & tech words
└── __tests__/
    └── topic.service.test.ts  # 27 tests
```

## Usage Example

```typescript
import { getBuiltinTopics, createTopicService } from "@polyglot/core";
import { topicRepository } from "@polyglot/db";
import { translateBatch } from "@polyglot/core";

// List topics (no deps needed)
const topics = getBuiltinTopics();

// Create service with injected deps
const service = createTopicService({
  translateBatch: (words, src, tgt) => translateBatch(words, src, tgt, model, generateObjectFn),
  getCached: topicRepository.getCached,
  setCached: topicRepository.setCached,
});

// Get translated words (cache-first)
const words = await service.getTopicWords("food", "en", ["cs", "de"]);
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (topics section)
- BRD: `docs/BRD.md` § Post-MVP 2.2 (Ready-Made Topic Sets)
