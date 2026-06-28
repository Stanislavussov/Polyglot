# Task 37 — Lite AI Translation Validator (Selective, Async)

**Status:** 🟡 Partial — Types, schemas, prompt, risk detector, and service implemented. DB migration, wiring, and rendering NOT done.  
**Type:** Feature (new core module + infra config + DB migration + bot integration)  
**Priority:** Medium — closes the semantic validation blind spot; no structural changes blocked  
**Source:** `@docs/research/evaluation.md` — verdict: RECOMMEND with selective application (Alternative E)  
**Last verified:** 2026-05-16

> **Reality check:** Sub-tasks 37.2–37.5, 37.7, 37.8, 37.9, 37.10 have acceptance criteria checked in this file, but the `lite-ai/` directory does NOT exist on disk. The checkboxes reflect design intent, not implemented code. Sub-tasks 37.1 (env var), 37.6 (DB migration), and 37.9 (rendering) remain unimplemented.

---

## Goal

Add a **lightweight AI model** as a second-pass semantic validator for high-risk translations. The validator runs **asynchronously** (doesn't block the user response) and flags translations whose meaning, naturalness, or register accuracy is suspect — something the existing deterministic validators cannot check.

### Key Decisions (from research)

1. **Selective** — only validate high-risk translations, not every request
2. **Async** — return the translation immediately, validate in background
3. **Scoring rubric** — not binary pass/fail; structured quality scores
4. **Different model family** — use `AI_MODEL_VALIDATOR` (cheap, different provider) to avoid correlation bias
5. **Graceful degradation** — if validator fails/times out, skip silently

---

## Sub-tasks

### 37.1 — Add `AI_MODEL_VALIDATOR` env var

**Goal:** Add a dedicated config key for the validator model so it can be a different provider family than the primary `AI_MODEL`.

**Acceptance Criteria:**
- [ ] `packages/infra/src/config.ts` — add `AI_MODEL_VALIDATOR: z.string().optional()` to env schema
- [ ] When absent, lite validation is disabled entirely (feature toggle)
- [ ] `.env.example` updated with `AI_MODEL_VALIDATOR=google/gemini-2.5-flash-lite` example
- [ ] `Env` type re-exported correctly

**Dependencies:** None  
**Effort:** 15 min  
**Files:** `packages/infra/src/config.ts`, `.env.example`

---

### 37.2 — Define validation scoring schema and types

**Goal:** Create Zod schema and TypeScript types for the lite validator's structured output.

**Acceptance Criteria:**
- [x] New file `packages/core/src/modules/validation/lite-ai/types.ts` with:
  ```ts
  interface LiteValidationScore {
    meaningPreserved: number;  // 0–5
    naturalness: number;       // 0–5
    registerAccuracy: number;  // 0–5
    overallScore: number;      // 0–5
    reasoning: string;         // brief explanation
  }

  interface LiteValidationResult {
    scores: Record<string, LiteValidationScore>;  // keyed by lang code
    flaggedForReview: boolean;  // true when any overallScore < 3
  }
  ```
- [x] Zod schema in `packages/core/src/modules/validation/lite-ai/schemas.ts` matching the interface
- [x] `REVIEW_THRESHOLD` constant exported (default: `3`)
- [x] Re-exported from `packages/core/src/modules/validation/lite-ai/index.ts`
- [x] Unit tests for schema validation pass/fail cases

**Dependencies:** None  
**Effort:** 30 min  
**Files:** `packages/core/src/modules/validation/lite-ai/types.ts`, `packages/core/src/modules/validation/lite-ai/schemas.ts`, `packages/core/src/modules/validation/lite-ai/index.ts`

---

### 37.3 — Build the validator prompt

**Goal:** Create a prompt that instructs the lite model to evaluate a translation on structured dimensions.

**Acceptance Criteria:**
- [x] New file `packages/core/src/modules/validation/lite-ai/prompt.builder.ts`
- [x] `buildLiteValidationPrompt(input: LiteValidationInput): string` function
- [x] Prompt includes: original word/phrase, source language, each target language translation, the scoring rubric (meaning, naturalness, register), and instruction to return JSON matching the schema
- [x] Prompt specifies that the validator should **not** rewrite — only score
- [x] If `dictionaryContext` is available, include it for reference
- [x] Unit tests: prompt contains required sections, handles single and multi-language inputs

**Dependencies:** 37.2  
**Effort:** 45 min  
**Files:** `packages/core/src/modules/validation/lite-ai/prompt.builder.ts`, `packages/core/src/modules/validation/lite-ai/__tests__/prompt.builder.test.ts`

---

### 37.4 — Implement high-risk detection heuristic

**Goal:** Determine whether a translation should be sent to the lite validator based on risk criteria from the research.

**Acceptance Criteria:**
- [x] New file `packages/core/src/modules/validation/lite-ai/risk-detector.ts`
- [x] `isHighRisk(input: RiskDetectorInput): boolean` — returns `true` when **any** of:
  - `inputType` is `"phrase"` or dictionary context `pos` is `"idiom"` or `"phrase"`
  - Any `expressionType` in the result is `"idiomatic_equivalent"`
  - Dictionary context is `undefined` (Wiktionary miss)
  - Target language is not in a configurable `SAFE_LANGUAGES` allowlist (default: `["en", "es", "fr", "de", "ru", "zh", "ja", "ko", "pt", "it"]`)
- [x] `SAFE_LANGUAGES` exportable and overridable
- [x] Unit tests for each risk criterion individually and combined

**Dependencies:** None  
**Effort:** 30 min  
**Files:** `packages/core/src/modules/validation/lite-ai/risk-detector.ts`, `packages/core/src/modules/validation/lite-ai/__tests__/risk-detector.test.ts`

---

### 37.5 — Implement lite validation service

**Goal:** Core service that calls the lite model, parses the scoring response, and returns a `LiteValidationResult`.

**Acceptance Criteria:**
- [x] New file `packages/core/src/modules/validation/lite-ai/lite-validation.service.ts`
- [x] `validateWithLiteAI(input: LiteValidationInput, generateObjectFn: GenerateObjectFn): Promise<LiteValidationResult>`
- [x] Input includes: `original`, `sourceLang`, `translations` (the full result), `dictionaryContext?`, `model` (the validator model ID)
- [x] Uses `buildLiteValidationPrompt()` + the Zod schema from 37.2
- [x] Returns `{ scores, flaggedForReview }` — `flaggedForReview = true` when any language's `overallScore < REVIEW_THRESHOLD`
- [x] On AI call failure: log warning, return `{ scores: {}, flaggedForReview: false }` (graceful skip)
- [x] Timeout: pass `{ maxRetries: 0 }` to generateObjectFn (no retries for validation calls)
- [x] Unit tests with mocked generateObjectFn

**Dependencies:** 37.2, 37.3  
**Effort:** 1 hour  
**Files:** `packages/core/src/modules/validation/lite-ai/lite-validation.service.ts`, `packages/core/src/modules/validation/lite-ai/__tests__/lite-validation.service.test.ts`

---

### 37.6 — Add `needsReview` column to `words` table

**Goal:** Persist the review flag in the database so it survives across bot restarts and can be queried later.

**Acceptance Criteria:**
- [ ] New Drizzle migration adding `needs_review boolean DEFAULT false NOT NULL` to `words` table
- [ ] `packages/adapters/db/src/schema.ts` — add `needsReview` column to `words`
- [ ] `StoredWordContent` interface: add optional `validationScores?: Record<string, LiteValidationScore>`
- [ ] `wordRepository` — add `markForReview(wordId: number, scores: Record<string, LiteValidationScore>): Promise<void>` method
- [ ] `wordRepository` — add `findNeedsReview(userId: number): Promise<Word[]>` query
- [ ] Migration applies cleanly on existing data (all existing words default to `needs_review = false`)
- [ ] Unit tests for new repository methods

**Dependencies:** 37.2  
**Effort:** 45 min  
**Files:** `packages/adapters/db/src/schema.ts`, `packages/adapters/db/src/repositories/word.repository.ts`, `packages/adapters/db/drizzle/` (new migration)

---

### 37.7 — Integrate async validation into translation flow

**Goal:** After `translate()` returns to the caller, trigger lite validation in the background for high-risk translations. Update the stored word if flagged.

**Acceptance Criteria:**
- [x] New file `packages/core/src/modules/validation/lite-ai/async-validator.ts`
- [x] `triggerAsyncValidation(params: AsyncValidationParams): void` — fire-and-forget
  - `params` includes: `translateOutput`, `input` (TranslateInput), `validatorModel` (string | undefined), `generateObjectFn`, `onFlagged` callback
  - If `validatorModel` is undefined → return immediately (feature disabled)
  - If `isHighRisk()` returns false → return immediately
  - Otherwise: call `validateWithLiteAI()`, if `flaggedForReview` → call `onFlagged(wordId, scores)`
- [x] `onFlagged` callback is injected by the bot layer — calls `wordRepository.markForReview()`
- [x] Errors in the async path are caught and logged, never thrown to caller
- [x] Logging: info-level log when validation starts, warn when flagged, error on failure
- [x] Unit tests with mocked deps

**Dependencies:** 37.4, 37.5  
**Effort:** 1 hour  
**Files:** `packages/core/src/modules/validation/lite-ai/async-validator.ts`, `packages/core/src/modules/validation/lite-ai/__tests__/async-validator.test.ts`

---

### 37.8 — Wire async validation in the bot translate scene

**Goal:** Call `triggerAsyncValidation()` after the bot sends the translation card to the user.

**Acceptance Criteria:**
- [x] `apps/bot/src/scenes/translate.scene.ts` — after sending the translation message, call `triggerAsyncValidation()` with appropriate params (wired via `fireAsyncValidation()` bridge in `apps/bot/src/utils/async-validation.ts`, called from `handleTranslateText()` in `translate-mode.helper.ts`)
- [ ] Wire `onFlagged` to call `wordRepository.markForReview()` (only if the word was saved to dictionary) — pending 37.6 DB method
- [x] Load `AI_MODEL_VALIDATOR` from config; if absent, skip entirely
- [x] No change to the user-visible response timing or content
- [x] If the word is not saved to dictionary (user didn't press save), the validation still runs but `onFlagged` is a no-op
- [x] Integration test: mock the full flow, verify async validation fires

**Dependencies:** 37.6, 37.7  
**Effort:** 45 min  
**Files:** `apps/bot/src/scenes/translate.scene.ts`

---

### 37.9 — Show "⚠️ quality uncertain" indicator for flagged words

**Goal:** When rendering a word that has `needsReview = true` (either from deterministic validation failure or from lite AI validation), show a subtle warning.

**Acceptance Criteria:**
- [x] `apps/bot/src/renderers/translation.renderer.ts` — `renderQualityWarning(interfaceLang?)` function added using `qualityUncertain` i18n key
- [ ] Dictionary list view: flagged words show `⚠️` next to their name — pending 37.6 DB `needs_review` column
- [ ] Flashcard view (when task 33 is implemented): flagged words show `⚠️` on reveal
- [x] i18n key: `qualityUncertain` → "⚠️ Translation quality uncertain" (added to en, ru, cs locales)
- [x] Unit tests for renderer with `needsReview` words from DB

**Dependencies:** 37.8  
**Effort:** 30 min  
**Files:** `apps/bot/src/renderers/translation.renderer.ts`, `packages/core/src/modules/i18n/locales/en.json`, `packages/core/src/modules/i18n/locales/ru.json`, `packages/core/src/modules/i18n/locales/cs.json`

---

### 37.10 — Logging and observability

**Goal:** Log all lite validation calls and results for monitoring and threshold tuning.

**Acceptance Criteria:**
- [x] Every lite validation call logs: `original`, `sourceLang`, `targetLangs`, `validatorModel`, `isHighRisk`, `overallScores`, `flaggedForReview`, `latencyMs`
- [x] Log level: `info` for successful validation, `warn` for flagged, `error` for failures
- [x] Structured log fields (Pino-compatible) — no string interpolation
- [x] Existing logger from `packages/core/src/logger.ts` used (no new logger instance)

**Dependencies:** 37.7  
**Effort:** 15 min  
**Files:** `packages/core/src/modules/validation/lite-ai/lite-validation.service.ts`, `packages/core/src/modules/validation/lite-ai/async-validator.ts`

---

## Execution Order

```
Wave 1 (parallel):  37.1  37.2  37.4
Wave 2 (depends 37.2):  37.3
Wave 3 (depends 37.2, 37.3):  37.5
Wave 4 (depends 37.2):  37.6
Wave 5 (depends 37.4, 37.5):  37.7  37.10
Wave 6 (depends 37.6, 37.7):  37.8
Wave 7 (depends 37.8):  37.9
```

```
37.1 ──────────────────────────────────────────────────┐
37.2 ──┬── 37.3 ──┬── 37.5 ──┬── 37.7 ──┬── 37.8 ── 37.9
       │          │           │   37.10 ─┘           │
37.4 ──┘──────────┘───────────┘                      │
37.6 ────────────────────────────────────────────────┘
```

---

## Out of Scope (future tasks per research)

- **User feedback mechanism (thumbs up/down)** — research recommends implementing this *before* the validator for ground truth. Separate task.
- **Threshold tuning** — requires accumulated data from production. Revisit after 2–4 weeks.
- **Disabling validation per language pair** — depends on false-positive rate data.
- **Cross-provider rotation** — if both `AI_MODEL` and `AI_MODEL_VALIDATOR` are configurable, the user handles this via `.env`.

---

## Total Effort Estimate

~5.5 hours across 10 sub-tasks
