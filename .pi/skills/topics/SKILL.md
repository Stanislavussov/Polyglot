---
name: topics
description: Topic management with built-in datasets, cache-first translation, and custom topic generation. Provides getBuiltinTopics(), getTopicWords(), generateCustomTopic(), and cache status. Use when implementing or modifying topic-related features, dataset loading, or translation caching.
---

# topics Agent Skill

## Module Location

`packages/core/src/` — specifically the `modules/topics/` subdirectory (to be created following `docs/tech-reqs/02-architecture.md`).

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `translation` agent (for batch translation), `db` agent (for cache via TopicRepository)
- **Dependents:** `notifications` agent (picks words from topics), `bot` agent (displays topics)

## Current State

Not yet implemented. `packages/core/src/index.ts` is empty.

## Rules

1. Always checks cache before calling the `translation` agent
2. Calls `translation` in batch only — never one word at a time
3. Knows nothing about the user — works with language pairs
4. Built-in datasets are loaded once at startup

## Built-in Datasets

JSON files in `packages/core/src/modules/topics/datasets/`:
- `food.json` — food & cooking vocabulary
- `travel.json` — travel & transportation
- `it-terms.json` — IT & programming terms

Each dataset:
```json
{
  "id": "food",
  "name": "Food & Cooking",
  "emoji": "🍳",
  "words": ["apple", "bread", "butter", "cheese", ...]
}
```

## Skills (Public API)

```typescript
// List all built-in topics (metadata only, no translations)
function getBuiltinTopics(): TopicMeta[];

// Get words with translations for a topic (cache-first, then AI batch)
async function getTopicWords(
  topicId: string,
  sourceLang: string,
  targetLangs: string[]
): Promise<TopicWord[]>;

// Generate a custom topic via AI
async function generateCustomTopic(
  prompt: string,
  sourceLang: string,
  targetLangs: string[]
): Promise<Topic>;

// Check cache status for a topic
function getCacheStatus(
  topicId: string,
  sourceLang: string,
  targetLangs: string[]
): Promise<CacheStatus>;
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
  translations: Record<string, TranslationEntry>;  // from translation module
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
```

## File Structure

```
packages/core/src/modules/topics/
├── index.ts              # Re-exports: getBuiltinTopics, getTopicWords, generateCustomTopic, getCacheStatus
├── types.ts              # TopicMeta, TopicWord, Topic, CacheStatus
├── topic.service.ts      # Main service with cache-first logic
└── datasets/
    ├── food.json
    ├── travel.json
    └── it-terms.json
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (topics section)
