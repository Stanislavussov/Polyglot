---
name: validation
description: AI response quality validation with pure deterministic checks. Validates schema (Zod), semantic correctness, language detection (franc), and example quality. Use when implementing or modifying translation validation logic.
---

# validation Agent Skill

## Module Location

`packages/core/src/modules/validation/` — pure functions, no I/O, no side effects.

## Architecture Context

- **Layer:** Core (platform-independent, pure functions, no I/O)
- **Dependencies:** `zod` (schema validation), `franc-min` (language detection)
- **Dependents:** `translation` agent calls validators before returning results

## Rules

1. Pure functions only — no side effects, no I/O
2. Never calls AI — only deterministic checks
3. Each rule is a separate function named `validate*`
4. Always returns a failure reason — always explains what went wrong

## Validation Pipeline

```
AI Response
    │
    ├─ 1. validateSchema (Zod)           — structural JSON validation
    ├─ 2. validateSemantic               — translation ≠ original, no hallucinations
    ├─ 3. validateLanguage (franc)        — detected language matches expected
    ├─ 4. validateExamples               — examples contain the translated word
    │
    ├─ PASS → return valid result
    ├─ FAIL → retry with strict prompt (up to 2 retries)
    └─ FAIL after retries → return with needsReview=true + ⚠️
```

## Public API

```typescript
// Zod structural validation
function validateSchema(raw: unknown, schema: ZodSchema): ValidationResult;

// Semantic checks: translation ≠ original, no hallucination patterns
// Patterns: "N/A", "I cannot", "I can't", "I'm unable", "—", "...", "undefined", "null", "[translation]", "<translation>"
function validateSemantic(original: string, translation: string): ValidationResult;

// Language detection via franc-min
// Skips validation for text <15 chars (franc accuracy too low)
// Accepts ISO 639-1 ("en"), ISO 639-3 ("eng"), or full names ("english")
function validateLanguage(text: string, expectedLang: string): ValidationResult;

// Helper to resolve language identifiers to ISO 639-3 codes
function resolveToIso3(lang: string): string | undefined;

// Example quality: examples must have target + native text, target must contain translated word
// Supports case-insensitive and stem-tolerant matching for inflected forms
function validateExamples(examples: ExampleInput[], word: string): ValidationResult;

// Orchestrated: runs all validators in sequence against full translation result
// Steps: 1) schema → 2) per-language: semantic, language, examples
// On schema failure: stops early (cannot inspect content)
// Reports missing translations for expected languages
function validate(raw: unknown, schema: ZodSchema, original: string, expectedLangs: string[]): ValidationResult;
```

## Types

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  rule: string;       // "schema" | "semantic" | "language" | "examples"
  message: string;    // Human-readable failure reason
  field?: string;     // Dot-path to failing field (e.g. "translations.cs.text")
}

interface ValidateInput {
  raw: unknown;
  schema: ZodSchema;
  original: string;
  expectedLangs: string[];
}

interface ExampleInput {
  context: string;
  target: string;
  native: string;
}
```

## File Structure

```
packages/core/src/modules/validation/
├── index.ts                              # Re-exports + validate() orchestrator
├── types.ts                              # ValidationResult, ValidationError, ValidateInput
├── validators/
│   ├── schema.validator.ts               # validateSchema()
│   ├── semantic.validator.ts             # validateSemantic()
│   ├── language.validator.ts             # validateLanguage(), resolveToIso3()
│   └── example.validator.ts              # validateExamples()
└── __tests__/
    ├── schema.validator.test.ts          # 8 tests
    ├── semantic.validator.test.ts        # 14 tests
    ├── language.validator.test.ts        # 11 tests
    ├── example.validator.test.ts         # 7 tests
    └── validate.test.ts                  # 14 tests (8 orchestrator + 6 single-language partial regen)
```

## Logging Integration

When validation fails in the translation service (`packages/core/src/modules/translation/translation.service.ts`):
- Each failed attempt → `console.warn('[translation] validation failed', { original, retryCount, failReason })`
- All retries exhausted → `console.error('[translation] validation failed after all retries — returning needsReview', { original, retryCount, failReason })`

Core uses `console.warn`/`console.error` (not pino) to stay infra-free per clean architecture.

## Current State

- All 5 validators implemented and tested (54 tests total)
- `validate()` orchestrator supports single-language validation for partial regeneration (Task 07)
- No code changes needed for Task 07 — existing `validate(raw, schema, original, [singleLang])` works correctly
- Added 6 tests confirming single-language validation for partial regeneration scenarios

## Reference

- Validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (validation section)
- Task: `docs/tasks/04-ai-translation-pipeline.md` (Step 3)
- Task: `docs/tasks/05-logging.md` (Step 3 — validation error logging)
- Task: `docs/tasks/07-partial-regeneration.md` (single-language validation coverage)
