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
    ├─ 4. validateNativeFields           — script, romanization, pronunciation, duplication
    ├─ 5. validateExamples               — examples well-formed + phrase/inflection matching
    │                                       (relaxed for idiomatic equivalents)
    │                                       ⚠️ SKIPPED when inputType='sentence'
    ├─ 6. validateAlternatives (semantic) — alternatives[].text ≠ original, no hallucinations
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

Lite AI Async Path (Task 37) — after translate() returns:
    │
    ├─ isHighRisk()                      — phrase/idiom, idiomatic_equivalent, Wiktionary miss, uncommon lang
    ├─ If high-risk + AI_MODEL_VALIDATOR set:
    │   ├─ buildLiteValidationPrompt()   — structured scoring prompt (5 dimensions, 0–5 scale)
    │   ├─ validateWithLiteAI()          — call lite model, parse scores, determine review flag
    │   └─ If flaggedForReview → onFlagged callback (injected by bot layer)
    └─ Fire-and-forget — never blocks user, graceful degradation on failure
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

// Deterministic validation for fields that must use the native language.
// Rejects duplicated target/native examples, copied notes, pronunciation/IPA,
// and high-confidence Russian romanization without applying unreliable
// short-text statistical detection.
function validateNativeFields(
  raw: Record<string, unknown>,
  translations: Record<string, Record<string, unknown>>,
  expectedLangs: string[],
  nativeLang: string,
): ValidationResult;

// Example quality validation. The first literal example must contain the main
// translation; Unicode phrases and conservative inflected forms are supported.
function validateExamples(
  examples: ExampleInput[],
  word: string,
  expressionType?: ExpressionType,
): ValidationResult;

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

// ── Lite AI Validation (Task 37) ──

// Scores keyed by language code, each with 5 dimensions (0–5) + reasoning
interface LiteValidationScore {
  meaningPreserved: number; naturalness: number; registerAccuracy: number;
  overallScore: number; reasoning: string;
}

// Result: scores per language + boolean review flag
interface LiteValidationResult {
  scores: Record<string, LiteValidationScore>; flaggedForReview: boolean;
}

// Zod schemas for structured AI output parsing
const liteValidationScoreSchema: ZodObject;
const liteValidationResultSchema: ZodObject;

// Threshold below which a translation is flagged for review (default: 3)
const REVIEW_THRESHOLD: number;

// Build a validation prompt for the lite AI model
function buildLiteValidationPrompt(input: LiteValidationInput): string;

// Determine whether a translation is high-risk and should be validated
// Criteria: phrase/idiom input, idiomatic_equivalent, Wiktionary miss, uncommon language
function isHighRisk(input: RiskDetectorInput, safeLangs?: readonly string[]): boolean;

// Default safe languages allowlist (well-represented in AI training data)
const SAFE_LANGUAGES: readonly string[];

// AI generation function signature (injected, core never depends on AI adapter)
type LiteGenerateObjectFn = <T>(prompt: string, schema: ZodSchema<T>, model: string, options?: { maxRetries?: number }) => Promise<T>;

// Call lite AI model, parse scores, determine review flag. Graceful degradation on failure.
function validateWithLiteAI(input: LiteValidationInput, generateObjectFn: LiteGenerateObjectFn, model: string): Promise<LiteValidationResult>;

// Fire-and-forget async validation trigger. Checks risk, validates, calls onFlagged callback.
// Returns void immediately — async work runs in background with error handling.
function triggerAsyncValidation(params: AsyncValidationParams): void;
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

// ── Lite AI Validation Types (Task 37) ──

/** Quality score for a single target language translation (0–5 scale) */
interface LiteValidationScore {
  meaningPreserved: number;
  naturalness: number;
  registerAccuracy: number;
  overallScore: number;
  reasoning: string;
}

/** Result of lite AI validation across all target languages */
interface LiteValidationResult {
  scores: Record<string, LiteValidationScore>;
  flaggedForReview: boolean;
}

/** Input for the lite validation prompt builder */
interface LiteValidationInput {
  original: string;
  sourceLang: string;
  translations: Record<string, LanguageTranslation>;
  dictionaryContext?: DictionaryContext;
}

/** Input for the risk detector heuristic */
interface RiskDetectorInput {
  inputType?: "word" | "phrase" | "sentence";
  dictionaryContext?: DictionaryContext;
  expressionTypes?: ExpressionType[];
  targetLangs: string[];
}

/** Parameters for fire-and-forget async validation */
interface AsyncValidationParams {
  original: string;
  sourceLang: string;
  translations: Record<string, LanguageTranslation>;
  inputType?: "word" | "phrase" | "sentence";
  dictionaryContext?: DictionaryContext;
  expressionTypes?: ExpressionType[];
  targetLangs: string[];
  validatorModel?: string;
  generateObjectFn: LiteGenerateObjectFn;
  onFlagged: (scores: Record<string, LiteValidationScore>) => void;
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
│   ├── field-language.validator.ts        # validateNativeFields()
│   ├── example.validator.ts              # phrase/inflection-aware validateExamples()
│   └── wiktionary.validator.ts           # validateWiktionaryEntry(), validateWordContext(), validateGlosses(), validatePos(), KNOWN_POS
├── lite-ai/                              # Task 37 — Lite AI second-pass semantic validator
│   ├── index.ts                          # Re-exports all lite-ai symbols
│   ├── types.ts                          # LiteValidationScore, LiteValidationResult, LiteValidationInput, RiskDetectorInput, AsyncValidationParams
│   ├── schemas.ts                        # Zod schemas (liteValidationScoreSchema, liteValidationResultSchema) + REVIEW_THRESHOLD
│   ├── prompt.builder.ts                 # buildLiteValidationPrompt()
│   ├── risk-detector.ts                  # isHighRisk() + SAFE_LANGUAGES
│   ├── lite-validation.service.ts        # validateWithLiteAI() + LiteGenerateObjectFn type
│   ├── async-validator.ts                # triggerAsyncValidation() — fire-and-forget entry point
│   └── __tests__/
│       ├── schemas.test.ts               # 15 tests
│       ├── prompt.builder.test.ts        # 14 tests
│       ├── risk-detector.test.ts         # 20 tests
│       ├── lite-validation.service.test.ts  # 11 tests
│       └── async-validator.test.ts       # 9 tests
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

Lite AI validation (Task 37) uses `getLogger()` from `packages/core/src/logger.ts` with structured Pino-compatible fields:
- `info`: validation completed — logs `original`, `sourceLang`, `targetLangs`, `validatorModel`, `overallScores`, `flaggedForReview`, `latencyMs`
- `warn`: translation flagged for review — same fields
- `error`: validation failed — logs `original`, `sourceLang`, `targetLangs`, `validatorModel`, `latencyMs`, `error`
- Async validator logs `info` when validation starts (with `isHighRisk: true`), `error` on unexpected failures

## Current State

- 5 active validators + 1 no-op + 4 Wiktionary validators + lite-ai sub-module
- **TQ-04 (partial)**: `validateExamples()` no longer skips phrases or non-ASCII translations. The first literal example must contain every significant token from the main translation, with conservative prefix matching for normal Czech and Russian inflections. Idiomatic equivalents retain their explicit relaxation. Assigned variants for examples 2 and 3 remain to be implemented.
- **TQ-05/TQ-08**: `validateNativeFields()` rejects identical target/native examples, Latin-dominant Russian romanization, Russian-native explanatory fields (including `usageNote` and `connotationWarning`) without sufficient Cyrillic, embedded pronunciation/IPA markers, and notes copied across target-language blocks. Errors contain exact field paths and flow into retry prompts. Statistical short-text language detection remains intentionally disabled because low-confidence results are inconclusive rather than invalid.
- **Task 37**: New `lite-ai/` sub-module — lightweight AI second-pass semantic validator for high-risk translations. Runs asynchronously (fire-and-forget), scores translations on 4 dimensions (meaningPreserved, naturalness, registerAccuracy, overallScore), flags for review when `overallScore < REVIEW_THRESHOLD (3)`. Risk detection heuristic (`isHighRisk()`) filters to only validate phrases, idioms, Wiktionary misses, idiomatic equivalents, and uncommon languages. Uses dependency injection for AI generation function (`LiteGenerateObjectFn`). Graceful degradation on failure. Structured Pino-compatible logging. 69 tests across 5 test files. Re-exported from `validation/index.ts` (not yet re-exported from core main `index.ts`).
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
- **Task 28**: `validate()` accepts optional `ValidateOptions` parameter (`{ includeExamples?: boolean; includeAlternatives?: boolean }`). When `includeExamples: false`, example validation (step 4) is skipped. When `includeAlternatives: false`, alternatives semantic validation (step 5) is skipped. `translation.service.ts` passes `input.outputConfig` to `validate()`. `FULL_OUTPUT` preset fixed to `includeExamples: true`. 6 output-config-aware tests in `validate.test.ts`.

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
- Task: `docs/tasks/finished/28-validation-respects-output-config.md` (ValidateOptions — skip validation for disabled output fields)
- Task: `docs/tasks/37-lite-ai-translation-validator.md` (Lite AI second-pass semantic validator — risk detection, structured scoring, async fire-and-forget)
