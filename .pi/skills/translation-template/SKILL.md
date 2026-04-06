---
name: translation-template
description: Translation output configuration — templates, presets, and field visibility. Provides resolveTemplate(), resolveOutputConfig(), output presets (FULL_OUTPUT, MINIMAL_OUTPUT, etc.), TemplateFields, and shared error classes. Use when implementing or modifying translation output configuration, user template management, or shared core types.
---

# translation-template Agent Skill

## Module Location

`packages/core/src/shared/` — shared core utilities used across multiple core modules.

## Architecture Context

- **Layer:** Core (platform-independent, shared utilities)
- **Dependencies:** None (leaf module — no internal or external deps)
- **Dependents:** `translation` module (output config in prompt/schema builders), `dictionary-pipeline` module (TemplateFields for display), `bot` agent (template scene, translate helpers), `db` agent (translation-template repository)

## Current State

Fully implemented with template types, output presets, resolution logic, and shared error classes.

## File Structure

```
packages/core/src/shared/
├── __tests__/
│   └── translation-template.test.ts
├── errors.ts                        # AppError, NotFoundError, ValidationFailedError
├── translation-output.presets.ts    # FULL_OUTPUT, MINIMAL_OUTPUT, NOTIFICATION_OUTPUT, SENTENCE_OUTPUT
├── translation-template.service.ts  # resolveOutputConfig(), resolveTemplate()
├── translation-template.types.ts    # TemplateFields, UserTranslationTemplate, DEFAULT_TEMPLATE
└── types.ts                         # TranslationOutputConfig interface
```

## Public API

### `resolveOutputConfig(template, inputContext?): TranslationOutputConfig`

Resolves a user's template + input context into a `TranslationOutputConfig` that controls which fields the AI prompt requests and the Zod schema validates.

- `template` — `UserTranslationTemplate | null` (null → `DEFAULT_TEMPLATE`)
- `inputContext` — `"word" | "phrase" | "sentence"` (sentence → `SENTENCE_OUTPUT` override)

### `resolveTemplate(userTemplate): UserTranslationTemplate`

Returns the user's template or `DEFAULT_TEMPLATE` if null.

### Output Presets

| Preset | Examples | Transcription | Synonyms | Alternatives | Use Case |
|---|---|---|---|---|---|
| `FULL_OUTPUT` | ✅ | ✅ | ✅ | ✅ | Default word/phrase |
| `MINIMAL_OUTPUT` | ❌ | ❌ | ❌ | ❌ | Minimal response |
| `NOTIFICATION_OUTPUT` | ✅ | ✅ | ❌ | ❌ | Scheduled notifications |
| `SENTENCE_OUTPUT` | ❌ | ✅ | ❌ | ❌ | Sentence translations |

### `MAX_TRANSCRIPTION_INPUT_LENGTH`

Constant (number). Inputs longer than this skip transcription to save tokens.

## Key Types

```typescript
interface TranslationOutputConfig {
  includeExamples: boolean;
  includeTranscription: boolean;
  includeSynonyms: boolean;
  includeAlternatives: boolean;
  includeEquivalentNote: boolean;
  includeRegister: boolean;
  includeConnotationWarning: boolean;
}

interface TemplateFields {
  transcription: boolean;
  synonyms: boolean;
  examples: boolean;
  alternatives: boolean;
  equivalentNote: boolean;
  connotationWarning: boolean;
}

interface UserTranslationTemplate {
  fields: TemplateFields;
  name: string;
}

// DEFAULT_TEMPLATE — all fields enabled, name "default"
// TEMPLATE_FIELD_KEYS — array of TemplateFields keys

// Shared errors
class AppError { code: string }
class NotFoundError extends AppError
class ValidationFailedError extends AppError { details: string[] }
```

## Rules

- Shared module — no adapter imports, no side effects.
- `DEFAULT_TEMPLATE` is the single source of truth for default field visibility.
- Output presets are immutable constants — never mutate them.
- `resolveOutputConfig` is the only way to derive `TranslationOutputConfig` from a user template.
- Error classes are generic — used across all core modules.
