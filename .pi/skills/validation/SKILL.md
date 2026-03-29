---
name: validation
description: AI response quality validation with pure deterministic checks. Validates schema (Zod), semantic correctness, language detection (franc), example quality, and Wiktionary data integrity. Use when implementing or modifying translation validation logic.
---

# validation Agent Skill

## Module Location

`packages/core/src/modules/validation/` — pure functions, no I/O, no side effects.

## Architecture Context

- **Layer:** Core (platform-independent, pure functions, no I/O)
- **Dependencies:** `zod` (schema validation)
- **Dependents:** `translation` agent calls validators before returning results; `infra` import scripts use Wiktionary validators for data quality checks

## Boundary

- **Mode:** role — when this skill is active, you ARE the validation agent. Only modify the validation and language-detect modules.
- **Produces:** validation source code and tests in `packages/core/src/modules/validation/` and `packages/core/src/modules/language-detect/`
- **Never:** modify code outside `packages/core/src/modules/validation/` and `packages/core/src/modules/language-detect/`
- **Never:** call AI, perform I/O, or produce side effects — pure functions only
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/core/src/modules/validation/**`, `packages/core/src/modules/language-detect/**`

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
    │                                       ⚠️ SKIPPED when inputType='sentence'
    ├─ 3. validateLanguage                — no-op (franc-min removed, see below)
    ├─ 4. validateExamples               — examples well-formed + word matching
    │                                       (relaxed for idiomatic equivalents)
    │                                       ⚠️ SKIPPED when inputType='sentence'
    ├─ 5. validateAlternatives (semantic) — alternatives[].text ≠ original, no hallucinations
    │                                       ⚠️ SKIPPED when inputType='sentence'
    │
    ├─ PASS → return valid result
    ├─ FAIL → retry with strict prompt (up to 2 retries)
    └─ FAIL after retries → return with needsReview=true + ⚠️

Wiktionary Data
    │
    ├─ 6. validateWiktionaryEntry        — raw JSONL entry: word, lang_code, pos, senses, forms
    ├─ 7. validateWordContext            — parsed record: word, languageId, pos, formTags, glosses
    ├─ 8. validateGlosses               — array of non-empty definition strings
    └─ 9. validatePos                   — known POS tag check (phrase, noun, verb, idiom, etc.)
```

## Public API

```typescript
// Zod structural validation
function validateSchema(raw: unknown, schema: ZodSchema): ValidationResult;

// Semantic checks: translation ≠ original, no hallucination patterns
// Patterns: "N/A", "I cannot", "I can't", "I'm unable", "—", "...", "undefined", "null", "[translation]", "<translation>"
function validateSemantic(original: string, translation: string): ValidationResult;

// Language validation — no-op (always returns valid).
// franc-min was removed: trigram-based detection is unreliable for
// translation-length texts (15–40 chars), producing false positives
// (Czech↔German, Czech↔Spanish, etc.). Language correctness is ensured
// by AI prompt + Zod schema + semantic validation.
// Function retained for API compatibility.
function validateLanguage(text: string, expectedLang: string): ValidationResult;

// Helper to resolve language identifiers to ISO 639-3 codes
function resolveToIso3(lang: string): string | undefined;

// Example quality: examples must have target text and register label
// Context must be neutral | colloquial | professional (Task 31: "formal" → "neutral")
// Accepts optional expressionType parameter — when "idiomatic_equivalent",
// word-matching is relaxed (examples may not repeat the idiom verbatim)
function validateExamples(examples: ExampleInput[], word: string, expressionType?: ExpressionType): ValidationResult;

// Valid example context values (Task 31)
const VALID_EXAMPLE_CONTEXTS: readonly ["neutral", "colloquial", "professional"];
type ExampleContext = "neutral" | "colloquial" | "professional";

// Orchestrated: runs all validators in sequence against full translation result
// Steps: 1) schema → 2) per-language: semantic, language, examples, alternatives semantic
// On schema failure: stops early (cannot inspect content)
// Reports missing translations for expected languages
// Passes expressionType from language data to validateExamples()
// Validates alternatives[].text semantically (≠ original, no hallucinations)
// When inputType is 'sentence', steps 2 (semantic), 4 (examples), and 5 (alternatives)
// are skipped — only schema validation and language detection run.
// ValidateOptions drives validation from the output config — when a field is disabled
// (e.g. includeExamples: false), the corresponding validation step is skipped.
function validate(raw: unknown, schema: ZodSchema, original: string, expectedLangs: string[], inputType?: InputType, options?: ValidateOptions): ValidationResult;

// ── Wiktionary validators (Task 13) ──

// Validates a raw Wiktionary JSONL entry has required fields (word, lang_code, pos)
// and correct data types. Validates optional fields (lang, senses, forms) when present.
function validateWiktionaryEntry(entry: WiktionaryEntryInput): ValidationResult;

// Validates a parsed word context record before DB insertion.
// Required: word (string), languageId (positive int), pos (string).
// Optional: formTags (string[]), glosses (non-empty string[]).
function validateWordContext(record: WordContextInput): ValidationResult;

// Validates glosses (English definitions) array: non-empty, all strings, no blanks.
function validateGlosses(glosses: unknown): ValidationResult;

// Validates POS is a known Wiktionary tag. Returns error for unknown values
// (can be used for logging/filtering, not necessarily blocking).
function validatePos(pos: unknown): ValidationResult;

// Constant: list of known POS values from Wiktionary
const KNOWN_POS: readonly string[];
```

## Types

```typescript
/** Detected input type — drives prompt, schema, and validation behavior */
type InputType = "word" | "phrase" | "sentence";

/** Whether a translation is literal or an idiomatic equivalent */
type ExpressionType = "literal" | "idiomatic_equivalent";

/**
 * Output configuration that controls which validation steps run.
 * Mirrors the caller's TranslationOutputConfig — when a field is disabled,
 * validation skips the corresponding check.
 */
interface ValidateOptions {
  includeExamples?: boolean;      // When false, skip example validation
  includeAlternatives?: boolean;  // When false, skip alternatives semantic validation
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  rule: string;       // "schema" | "semantic" | "language" | "examples" | "wiktionary" | "wordContext" | "glosses" | "pos"
  message: string;    // Human-readable failure reason
  field?: string;     // Dot-path to failing field (e.g. "translations.cs.text")
}

interface ValidateInput {
  raw: unknown;
  schema: ZodSchema;
  original: string;
  expectedLangs: string[];
  inputType?: InputType;
}

interface ExampleInput {
  context: string;
  target: string;
  register: string;
}

/** Raw Wiktionary JSONL entry shape (subset of fields we validate) */
interface WiktionaryEntryInput {
  word?: unknown;
  lang?: unknown;
  lang_code?: unknown;
  pos?: unknown;
  forms?: unknown;
  senses?: unknown;
}

/** Parsed word context record ready for DB insertion */
interface WordContextInput {
  word?: unknown;
  languageId?: unknown;
  pos?: unknown;
  formTags?: unknown;
  glosses?: unknown;
}

/** Known POS values from Wiktionary */
type KnownPos = "noun" | "verb" | "adj" | "adv" | "phrase" | "idiom" | "proverb" | ...;
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
│   ├── example.validator.ts              # validateExamples() + ExpressionType
│   └── wiktionary.validator.ts           # validateWiktionaryEntry(), validateWordContext(), validateGlosses(), validatePos(), KNOWN_POS
└── __tests__/
    ├── schema.validator.test.ts          # 8 tests
    ├── semantic.validator.test.ts        # 14 tests
    ├── language.validator.test.ts        # 2 tests (validateLanguage no-op)
    ├── example.validator.test.ts         # 9 tests
    ├── example.validator.idiomatic.test.ts  # 8 tests (Task 10 — expressionType)
    ├── validate.test.ts                  # 40 tests (8 orchestrator + 6 partial regen + 5 idiomatic + 6 alternatives + 9 sentence inputType + 6 output-config-aware)
    └── wiktionary.validator.test.ts      # 58 tests (21 entry + 19 wordContext + 8 glosses + 10 pos)
```

## Logging Integration

When validation fails in the translation service (`packages/core/src/modules/translation/translation.service.ts`):
- Each failed attempt → `console.warn('[translation] validation failed', { original, retryCount, failReason })`
- All retries exhausted → `console.error('[translation] validation failed after all retries — returning needsReview', { original, retryCount, failReason })`

Core uses `console.warn`/`console.error` (not pino) to stay infra-free per clean architecture.

## Current State

- 4 active validators + 1 no-op + 4 Wiktionary validators (139 tests total across 7 test files in validation module)
- **Task 31**: `ExampleInput.native` removed, `ExampleInput.register` added (inline register label). `ExampleContext` changed from `formal | colloquial | professional` to `neutral | colloquial | professional`. `validateExamples()` validates register is non-empty and context is a valid value. `VALID_EXAMPLE_CONTEXTS` constant and `ExampleContext` type exported. `connotationWarning` is optional — no validation needed beyond Zod schema.
- **Task 27**: `validate()` accepts optional `inputType` parameter (`InputType = 'word' | 'phrase' | 'sentence'`). When `inputType === 'sentence'`, semantic validation (step 2), example validation (step 4), and alternatives semantic validation (step 5) are skipped — only schema validation and language detection run. `InputType` type exported from module. 9 sentence-specific tests in `validate.test.ts`.
- **Task 16**: New `language-detect` module (`packages/core/src/modules/language-detect/`) with `detectLanguage()` (franc + script heuristics) and `resolveTranslationDirection()` (direction logic). 33 tests across 2 test files. `franc` added as dependency to `@polyglot/core`. Types `ResolveDirectionInput`, `TranslationDirection` exported.
- **Task 17**: New `resolveDirectionFromSource()` in language-detect module — resolves translation direction from an explicit source language (no detection). Returns `null` if source lang is not in user's config (stale selection validation). 15 tests. Type `ResolveFromSourceInput` exported.
- `validateLanguage()` is a no-op — `franc-min` removed due to unreliable trigram detection on short texts. Language correctness ensured by AI prompt + Zod schema + semantic validation.
- `validate()` orchestrator supports single-language validation for partial regeneration (Task 07)
- `validateExamples()` accepts optional `expressionType` parameter (Task 10)
- `validate()` orchestrator passes `expressionType` from language data to `validateExamples()` (Task 10)
- `ExpressionType` type exported from module index
- 8 idiomatic tests in `example.validator.idiomatic.test.ts` + 5 orchestrator idiomatic tests in `validate.test.ts`
- **Task 13**: 4 new Wiktionary validators (`validateWiktionaryEntry`, `validateWordContext`, `validateGlosses`, `validatePos`) with 58 tests. `KNOWN_POS` constant exported for POS filtering. Types `WiktionaryEntryInput`, `WordContextInput`, `KnownPos` exported.
- `validate()` orchestrator validates `alternatives[].text` semantically — catches hallucinations and identity translations in alternative variants (6 tests in `validate.test.ts`)

## Language Detection Module (Task 16)

Separate module at `packages/core/src/modules/language-detect/` — pure functions, no I/O.

### Public API

```typescript
// Detect input language from a set of candidates using franc + script heuristics
function detectLanguage(text: string, candidates: string[]): string | undefined;

// Resolve translation direction based on detected language
function resolveTranslationDirection(input: ResolveDirectionInput): TranslationDirection;

// Resolve translation direction from an explicit source language (no detection).
// Used when user manually selects source language via inline keyboard (Task 17).
// Returns null if sourceLang is not in user's config (stale selection).
function resolveDirectionFromSource(input: ResolveFromSourceInput): TranslationDirection | null;

interface ResolveDirectionInput {
  text: string;         // User's input text
  nativeLang: string;   // ISO 639-1
  learningLangs: string[]; // ISO 639-1
}

interface ResolveFromSourceInput {
  sourceLang: string;      // Explicit source language (ISO 639-1)
  nativeLang: string;      // ISO 639-1
  learningLangs: string[]; // ISO 639-1
}

interface TranslationDirection {
  sourceLang: string;        // ISO 639-1
  targetLangs: string[];     // ISO 639-1
  detectedLang: string | undefined; // ISO 639-1 or undefined
}
```

### File Structure

```
packages/core/src/modules/language-detect/
├── index.ts                    # Re-exports
├── detect-language.ts          # detectLanguage() — franc + script heuristics
├── resolve-direction.ts        # resolveTranslationDirection() + resolveDirectionFromSource() — direction logic
├── types.ts                    # ResolveDirectionInput, ResolveFromSourceInput, TranslationDirection
└── __tests__/
    ├── detect-language.test.ts                # 22 tests
    ├── resolve-direction.test.ts              # 11 tests
    └── resolve-direction-from-source.test.ts  # 15 tests (Task 17)
```

## Reference

- Validation pipeline: `docs/tech-reqs/07-ai-validation.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (validation section)
- Task: `docs/tasks/04-ai-translation-pipeline.md` (Step 3)
- Task: `docs/tasks/05-logging.md` (Step 3 — validation error logging)
- Task: `docs/tasks/07-partial-regeneration.md` (single-language validation coverage)
- Task: `docs/tasks/10-idiomatic-equivalents.md` (idiomatic equivalent validation relaxation)
- Task: `docs/tasks/13-wiktionary-jsonl.md` (Wiktionary data integrity validation)
- Task: `docs/tasks/16-auto-detect-input-language.md` (language detection + direction resolver)
- Task: `docs/tasks/17-next-translation-language-menu.md` (explicit source lang direction resolver)
- Task: `docs/tasks/27-input-type-detection-and-text-limits.md` (sentence inputType — skip semantic/example/alternatives validation)
