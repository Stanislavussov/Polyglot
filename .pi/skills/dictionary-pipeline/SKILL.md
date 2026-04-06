---
name: dictionary-pipeline
description: Config-driven pipeline for reading words from a user's personal dictionary. Provides createDictionaryPipeline(), preset configs (FLASHCARD_CONFIG, NOTIFICATION_DICT_CONFIG, WORD_OF_DAY_DICT_CONFIG), and display data types. Use when implementing or modifying flashcard rendering, word-of-the-day selection, or dictionary word display.
---

# dictionary-pipeline Agent Skill

## Module Location

`packages/core/src/modules/dictionary-pipeline/` — core platform-independent module.

## Architecture Context

- **Layer:** Core (platform-independent)
- **Dependencies:** `translation` module (for `Register`, `ExpressionType`, and other translation types), `shared/` (for `TemplateFields`)
- **Dependents:** `bot` agent (flashcard scene, notification rendering), `notifications` agent (word-of-the-day)
- **Injection:** All adapter dependencies (`findEntriesByUser`, `getReviewCounts`) are injected via `DictionaryPipelineDeps` — core never imports adapters directly.

## Current State

Fully implemented with config-driven pipeline, preset configs, and word display types.

## File Structure

```
packages/core/src/modules/dictionary-pipeline/
├── __tests__/
│   ├── pipeline.test.ts
│   └── presets.test.ts
├── index.ts           # barrel re-exports
├── pipeline.ts        # createDictionaryPipeline() factory
├── presets.ts         # FLASHCARD_CONFIG, NOTIFICATION_DICT_CONFIG, WORD_OF_DAY_DICT_CONFIG
└── types.ts           # all interfaces and types
```

## Public API

### `createDictionaryPipeline(deps: DictionaryPipelineDeps)`

Factory function that returns a pipeline runner. Accepts injected dependencies for DB access.

- `deps.findEntriesByUser` — fetches vocabulary entries for a user
- `deps.getReviewCounts` — fetches review counts for word IDs
- Returns `(userId, config: DictionaryWordConfig) => Promise<WordPipelineResult>`

### Preset Configs

| Preset | Strategy | Limit | Use Case |
|---|---|---|---|
| `FLASHCARD_CONFIG` | `random` | 10 | Flashcard practice |
| `NOTIFICATION_DICT_CONFIG` | `oldest_first` | 1 | Scheduled notification word |
| `WORD_OF_DAY_DICT_CONFIG` | `oldest_first` | 1 | Word-of-the-day display |

## Key Types

```typescript
type WordSelectionStrategy = "random" | "oldest_first";

interface DictionaryWordConfig {
  selection: WordSelectionConfig;
  presentation: PresentationConfig;
}

interface WordDisplayData {
  id: number;
  original: string;
  sourceLang: string;
  inputType: string;
  emoji: string | null;
  register: Register | null;
  createdAt: Date;
  translations: WordDisplayTranslation[];
}

interface WordPipelineResult {
  words: WordDisplayData[];
  meta: { total: number; returned: number; strategy: WordSelectionStrategy };
}

interface DictionaryPipelineDeps {
  findEntriesByUser: (...) => Promise<PipelineEntry[]>;
  getReviewCounts: (...) => Promise<Map<number, number>>;
}
```

## Rules

- Pure core module — no adapter imports, all deps injected via `DictionaryPipelineDeps`.
- Preset configs are the single source of truth for word selection strategies.
- `TemplateFields` controls which translation fields are visible — loaded from the user's saved template.
- Never hardcode language codes or user settings.
