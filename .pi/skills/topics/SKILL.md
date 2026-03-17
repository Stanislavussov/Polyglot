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

Fully implemented with partial regeneration support and idiomatic equivalent passthrough. The `LanguageTranslationEntry` type includes optional `expressionType` and `equivalentNote` fields that flow transparently through cache reads, batch translations, and partial regeneration. All public API functions working with 47 tests passing (27 original + 10 for regenerateTopicWord + 10 for idiomatic equivalents).

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
  regenerateTopicWord: (topicId: string, original: string, sourceLang: string, targetLang: string) => Promise<LanguageTranslationEntry>;
};
```

### Dependency Injection

```typescript
interface TopicDeps {
  // Batch translate words (from translation module, pre-bound with model + generateObjectFn)
  translateBatch: (words: string[], sourceLang: string, targetLangs: string[]) => Promise<TranslateOutput[]>;
  // Single-language translation for partial regeneration (optional, pre-bound with model + generateObjectFn)
  translateOne?: (word: string, sourceLang: string, targetLang: string) => Promise<LanguageTranslationEntry>;
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

## Cache Strategy

- **Cache key:** `(topicId, original, sourceLang, targetLang)` — one row per word × language
- **Cache check:** For each word, check ALL target languages. Word is "cached" only when ALL langs have entries.
- **On miss:** Batch translate ALL uncached words in a single `translateBatch` call, then store results per-language in cache.
- **On partial regeneration:** `regenerateTopicWord` re-translates a single language for a topic word via `translateOne`, then overwrites the cache entry for that word+lang.
- **Shared:** Cache is shared across users with the same language pair — not per user.

## File Structure

```
packages/core/src/modules/topics/
├── index.ts              # Re-exports public API (incl. TopicExpressionType)
├── types.ts              # TopicMeta, TopicWord, Topic, CacheStatus, TopicDeps, TopicExpressionType
├── topic.service.ts      # getBuiltinTopics, createTopicService (factory)
├── datasets/
│   ├── food.json         # 25 food & cooking words
│   ├── travel.json       # 25 travel & transport words
│   └── it-terms.json     # 25 IT & tech words
└── __tests__/
    ├── topic.service.test.ts       # 37 tests (27 original + 10 regenerateTopicWord)
    └── idiomatic-equivalents.test.ts  # 10 tests for idiomatic field passthrough
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

// Regenerate a single language for a topic word (partial regeneration)
const newCsTranslation = await service.regenerateTopicWord("food", "apple", "en", "cs");
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (topics section)
- BRD: `docs/BRD.md` § Post-MVP 2.2 (Ready-Made Topic Sets)
