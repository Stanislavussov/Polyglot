---
name: validation
description: AI response quality validation with pure deterministic checks. Validates schema (Zod), semantic correctness, language detection (franc), and example quality. Use when implementing or modifying translation validation logic.
---

# validation Agent Skill

## Module Location

`packages/core/src/` — specifically the `modules/validation/` subdirectory (to be created following `docs/tech-reqs/02-architecture.md`).

## Architecture Context

- **Layer:** Core (platform-independent, pure functions, no I/O)
- **Dependencies:** None — leaf agent
- **Dependents:** `ai` agent and `translation` agent call validators before returning results

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
    └─ FAIL after retries → AI validation (paid) → needsReview=true with ⚠️
```

## Skills (Public API)

```typescript
// Zod structural validation
function validateSchema(raw: unknown, schema: ZodSchema): ValidationResult;

// Semantic checks: translation ≠ original, no hallucination patterns ("N/A", "I cannot", "—")
function validateSemantic(original: string, translation: string): ValidationResult;

// Language detection via franc
function validateLanguage(text: string, expectedLang: string): ValidationResult;

// Examples must contain the translated word
function validateExamples(examples: string[], word: string): ValidationResult;

// Orchestrated: runs all validators above in sequence
function validate(input: ValidateInput): ValidationResult;
```

## Types

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  rule: string;       // e.g. "schema", "semantic", "language", "examples"
  message: string;    // Human-readable failure reason
  field?: string;     // Optional: which field failed
}

interface ValidateInput {
  raw: unknown;
  schema: ZodSchema;
  original: string;
  translation: string;
  expectedLang: string;
  examples: string[];
  word: string;
}
```

## File Structure

```
packages/core/src/modules/validation/
├── index.ts                  # Re-exports all validators + validate()
├── types.ts                  # ValidationResult, ValidationError, ValidateInput
├── schema.validator.ts       # validateSchema()
├── semantic.validator.ts     # validateSemantic()
├── language.validator.ts     # validateLanguage() using franc
└── examples.validator.ts     # validateExamples()
```

## Reference

- Validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (validation section)
