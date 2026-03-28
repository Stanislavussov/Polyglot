# Task 21: Translation Output Config

**Status:** ✅ Done

## Goal

Add a `TranslationOutputConfig` that controls which sections appear in translation responses. The config must flow from the caller all the way into the AI prompt, so that **disabled fields are never requested from the AI at all** — not just hidden in the UI. This reduces token usage, speeds up responses, and makes the system flexible for use cases that don't need full verbosity (e.g., bulk topic translation, notification word-of-the-day, lightweight mode).

**Example use case:** Bulk topic translation uses the `MINIMAL_OUTPUT` preset → `{ includeExamples: false, includeSynonyms: false, ... }` → the AI prompt omits examples, synonyms, alternatives, and equivalentNote sections → the AI response has only core fields → fewer tokens consumed, faster batch processing.

---

## Problem Statement

Currently, the translation prompt **always** requests all fields: examples (3 per language), transcription, synonyms (2–3 per language), alternatives (2 per language), and expression-type metadata. There is no way to disable any of these sections at the API level:

```
CURRENT:
  Caller → translate(input) → buildTranslationPrompt() → fixed full prompt → AI
                                                        → fixed full schema → AI

DESIRED:
  Caller → translate(input, config) → buildTranslationPrompt(request) → config-aware prompt → AI
                                    → buildTranslationResultSchema(langs, config) → config-aware schema → AI
```

Every disabled field should be **absent from the prompt JSON template** and **relaxed in the Zod schema** (not just omitted from rendering), so:
1. The AI doesn't spend tokens generating it
2. The schema doesn't fail validation when the field is missing

---

## References

- `packages/core/src/modules/translation/prompt.builder.ts` — prompt construction to be made config-aware
- `packages/core/src/modules/translation/schemas/translation.schema.ts` — Zod schemas, `buildTranslationResultSchema()`
- `packages/core/src/modules/translation/types.ts` — `TranslateInput`, `TranslationRequest`
- `packages/core/src/modules/translation/translation.service.ts` — wires prompt + schema + AI call
- `packages/core/src/modules/context-enrichment/types.ts` — `EnrichedTranslateInput` (must pass config through)
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — bot-layer caller (ensure it still works unchanged)
- `apps/bot/src/renderers/translation.renderer.ts` — already handles absent optional fields (no changes needed)
- `.pi/skills/translation/SKILL.md` — skill to be updated

---

## `TranslationOutputConfig` Design

```typescript
/**
 * Controls which fields are included in the AI translation response.
 * All fields default to true (full output) when absent.
 * Set a field to false to omit it from the AI prompt entirely.
 */
interface TranslationOutputConfig {
  /** Include 3 contextual example sentences (formal/colloquial/professional). Default: true */
  includeExamples?: boolean;
  /** Include IPA transcription (required for non-Latin scripts). Default: true */
  includeTranscription?: boolean;
  /** Include 2–3 synonyms per language. Default: true */
  includeSynonyms?: boolean;
  /** Include up to 2 alternative translation variants. Default: true */
  includeAlternatives?: boolean;
  /** Include expressionType and equivalentNote for idiomatic expressions. Default: true */
  includeEquivalentNote?: boolean;
}
```

**All fields default to `true`** — passing no config, or an empty config `{}`, produces the same output as today. This is strictly backward-compatible.

---

## Centralized Presets (Single Source of Truth)

Output config is **NOT a user setting**. It is managed in one single file in code: `translation-output.presets.ts`. Every caller imports a named preset instead of constructing configs inline. When you need to change what a use case includes, you change it in **one place**.

```typescript
// packages/core/src/modules/translation/translation-output.presets.ts

import type { TranslationOutputConfig } from "./types.js";

/** All sections enabled — default for interactive translation & regeneration */
export const FULL_OUTPUT: TranslationOutputConfig = {
  includeExamples: true,
  includeTranscription: true,
  includeSynonyms: true,
  includeAlternatives: true,
  includeEquivalentNote: true,
};

/** Lightweight — for bulk topic translation, caching pipelines */
export const MINIMAL_OUTPUT: TranslationOutputConfig = {
  includeExamples: false,
  includeTranscription: true,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
};

/** Notification word-of-the-day — compact but still useful */
export const NOTIFICATION_OUTPUT: TranslationOutputConfig = {
  includeExamples: true,
  includeTranscription: true,
  includeSynonyms: false,
  includeAlternatives: false,
  includeEquivalentNote: false,
};
```

**Caller → preset mapping:**

| Caller | Preset | Rationale |
|---|---|---|
| `translate-mode.helper.ts` (bot interactive) | `FULL_OUTPUT` | User expects rich cards with examples, synonyms, alternatives |
| `regen.helper.ts` (regeneration) | `FULL_OUTPUT` | Same as interactive — full detail |
| `topic.service.ts` (bulk topic translation) | `MINIMAL_OUTPUT` | Cached batch job — save tokens, only need core translation + transcription |
| Notification word-of-the-day (future) | `NOTIFICATION_OUTPUT` | Compact push — examples help but synonyms/alternatives are noise |

---

## Subtasks

### Step 1: Define `TranslationOutputConfig` Type

**File:** `packages/core/src/modules/translation/types.ts`

- Add `TranslationOutputConfig` interface (fields above)
- Add `outputConfig?: TranslationOutputConfig` to `TranslateInput`
- Add `outputConfig?: TranslationOutputConfig` to `TranslationRequest`

**Acceptance criteria:**
- `TranslationOutputConfig` is defined and exported from `translation/types.ts`
- `TranslateInput.outputConfig` and `TranslationRequest.outputConfig` are optional (breaking nothing)
- TypeScript compiles cleanly with no new errors

---

### Step 2: Create Centralized Presets File

**File:** `packages/core/src/modules/translation/translation-output.presets.ts`

- Create the file with `FULL_OUTPUT`, `MINIMAL_OUTPUT`, and `NOTIFICATION_OUTPUT` presets as defined above
- Each preset is a `const` with explicit values for all 5 fields (no implicit defaults — presets are the source of truth)

**Acceptance criteria:**
- `FULL_OUTPUT` has all 5 fields set to `true`
- `MINIMAL_OUTPUT` has `includeTranscription: true`, all others `false`
- `NOTIFICATION_OUTPUT` has `includeExamples: true`, `includeTranscription: true`, all others `false`
- All presets satisfy the `TranslationOutputConfig` type

---

### Step 3: Export `TranslationOutputConfig` and Presets from Module Indexes

**Files:** `packages/core/src/modules/translation/index.ts`, `packages/core/src/index.ts`

- Re-export `TranslationOutputConfig` from `translation/index.ts`
- Re-export `FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT` from `translation/index.ts`
- `packages/core/src/index.ts` already uses `export * from "./modules/translation/index.js"` — no change needed there

**Acceptance criteria:**
- `import { TranslationOutputConfig } from "@polyglot/core"` resolves correctly
- `import { FULL_OUTPUT, MINIMAL_OUTPUT, NOTIFICATION_OUTPUT } from "@polyglot/core"` resolves correctly

---

### Step 4: Make Prompt Builder Config-Aware

**File:** `packages/core/src/modules/translation/prompt.builder.ts`

`buildTranslationPrompt(request: TranslationRequest): string` reads `request.outputConfig` and conditionally includes or excludes each section. Use a helper `resolveConfig(config?: TranslationOutputConfig)` to normalise all fields to `true` by default.

#### 3a — Per-language JSON template (inside the `targetLangs.map(...)` block)

Each field in the template is conditionally included:

| Config field | Template fragment to omit when `false` |
|---|---|
| `includeTranscription: false` | `"transcription": "<IPA transcription...>"` line |
| `includeSynonyms: false` | `"synonyms": [...]` block (also remove synonym references in alternatives) |
| `includeAlternatives: false` | `"alternatives": [...]` block |
| `includeEquivalentNote: false` | `"expressionType": "..."` and `"equivalentNote": "..."` lines |
| `includeExamples: false` | `"examples": [...]` block |

#### 3b — Rules block

| Config field | Rule lines to omit when `false` |
|---|---|
| `includeExamples: false` | The entire "VARIETY IN EXAMPLES IS MANDATORY" block (3 bullet points) and "Provide exactly 3 example sentences per language" rule |
| `includeSynonyms: false` | "Provide 2–3 synonyms per language" rule |
| `includeAlternatives: false` | "Provide exactly 2 alternative translations per language" rule; also remove synonym guidance inside the alternatives template line |
| `includeEquivalentNote: false` | The entire "Idiomatic & Proverb Rule:" block at the bottom of the prompt |

#### 3c — `buildStrictPrompt` retry validation checklist

`buildStrictPrompt` calls `buildTranslationPrompt` internally (already), so it inherits config-aware prompt automatically. Update the "Double-check" bullet list at the bottom of `buildStrictPrompt` to also be conditional:
- Remove the examples variety bullet when `includeExamples: false`
- Remove the idiomatic expression bullet when `includeEquivalentNote: false`

**Acceptance criteria:**
- When `includeExamples: false` → prompt string does not contain `"examples"`, does not contain `"VARIETY IN EXAMPLES IS MANDATORY"`, does not contain `"3 example sentences"`
- When `includeTranscription: false` → prompt string does not contain `"transcription"` inside the language template
- When `includeSynonyms: false` → prompt string does not contain `"synonyms"` inside the language template
- When `includeAlternatives: false` → prompt string does not contain `"alternatives"` inside the language template, does not contain `"2 alternative translations"`
- When `includeEquivalentNote: false` → prompt string does not contain `"expressionType"`, does not contain `"Idiomatic & Proverb Rule"`
- When config is `undefined` or `{}` → prompt is identical to current prompt (100% backward compatible)
- All 21 existing `prompt.builder.test.ts` tests still pass

---

### Step 5: Make Zod Schema Builder Config-Aware

**File:** `packages/core/src/modules/translation/schemas/translation.schema.ts`

Update `buildTranslationResultSchema(targetLangs: string[], config?: TranslationOutputConfig)`:
- Add optional `config` parameter
- Build a per-language schema that relaxes validation for disabled fields:

| Config field | Schema change |
|---|---|
| `includeExamples: false` | `examples` field: `z.array(exampleSchema).default([])` instead of `.min(1, ...)` |
| `includeSynonyms: false` | `synonyms` field: `z.array(synonymSchema).default([])` instead of `.array(synonymSchema)` |
| `includeAlternatives: false` | Already optional — no change needed |
| `includeTranscription: false` | Already optional — no change needed |
| `includeEquivalentNote: false` | Already optional — no change needed |

Extract a helper: `buildLanguageTranslationSchema(config?: TranslationOutputConfig): ZodSchema` that creates a per-language schema with the given config. `buildTranslationResultSchema` uses this helper per-language.

**Acceptance criteria:**
- `buildTranslationResultSchema(["cs"], { includeExamples: false })` produces a schema that validates successfully when `examples` is `[]` or absent
- `buildTranslationResultSchema(["cs"], { includeSynonyms: false })` produces a schema that validates successfully when `synonyms` is `[]` or absent
- Default (no config): schema behavior is identical to today (32 existing schema tests pass)
- `buildLanguageTranslationSchema` is exported from the schema module

---

### Step 6: Wire Config Through Translation Service

**File:** `packages/core/src/modules/translation/translation.service.ts`

- When building the `TranslationRequest`, copy `input.outputConfig` into it:
  ```typescript
  const request: TranslationRequest = {
    ...,
    outputConfig: input.outputConfig,
  };
  ```
- When building the schema, pass the config:
  ```typescript
  const schema = buildTranslationResultSchema(input.targetLangs, input.outputConfig);
  ```
- `translateOne()` and `translateBatch()` already delegate to `translate()` — no additional changes needed there

**Acceptance criteria:**
- `translate({ ..., outputConfig: { includeExamples: false } }, generateObjectFn)` uses a prompt without examples and a schema that doesn't require examples
- No change to the function signature's required parameters (config is optional)
- All 61 existing `translation.service.test.ts` tests still pass

---

### Step 7: Wire Config Through Context-Enrichment Layer

**File:** `packages/core/src/modules/context-enrichment/types.ts`

`EnrichedTranslateInput` currently extends `TranslateInput` with `Omit<..., "dictionaryContext">`. Since `TranslateInput` now has `outputConfig?`, it is already inherited. Verify this is the case and add a note in the types file.

**File:** `packages/core/src/modules/context-enrichment/context-enrichment.service.ts`

- Confirm `translateWithContext()`, `translateOneWithContext()`, and `translateBatchWithContext()` pass `outputConfig` through to the underlying `translate()` / `translateOne()` / `translateBatch()` calls — since they spread or forward `EnrichedTranslateInput`, this should already work.
- If `outputConfig` is not forwarded automatically, explicitly add it.

**Acceptance criteria:**
- `translateWithContext({ ..., outputConfig: { includeExamples: false } }, deps)` forwards the config to `translate()` unchanged
- All 21 existing context-enrichment tests pass
- TypeScript compiles cleanly

---

### Step 8: Wire Presets into Callers

Update all existing callers to import and pass the appropriate preset. This is the step where the centralized config takes effect across the codebase.

**File:** `apps/bot/src/scenes/helpers/translate-mode.helper.ts`
- Import `FULL_OUTPUT` from `@polyglot/core`
- Pass `outputConfig: FULL_OUTPUT` in the `translateWithContext()` input

**File:** `apps/bot/src/scenes/helpers/regen.helper.ts`
- Import `FULL_OUTPUT` from `@polyglot/core`
- Pass `outputConfig: FULL_OUTPUT` in the `translateOne()` input

**File:** `packages/core/src/modules/topics/topic.service.ts`
- Import `MINIMAL_OUTPUT` from the translation module
- Pass `outputConfig: MINIMAL_OUTPUT` in `translateBatch()` and `translateOne()` inputs

**Acceptance criteria:**
- Every call site that invokes `translate()` / `translateOne()` / `translateBatch()` / `translateWithContext()` passes an explicit preset — no call site constructs its own `TranslationOutputConfig` inline
- All existing tests still pass (presets with `FULL_OUTPUT` produce identical behavior to today)
- `topic.service.ts` uses `MINIMAL_OUTPUT` → bulk translation prompts are shorter (no examples, synonyms, alternatives, equivalentNote)

---

### Step 9: Write Unit Tests for Output Config

**File:** `packages/core/src/modules/translation/__tests__/output-config.test.ts`

Write at least **20 tests** covering:

**Preset tests:**
1. `FULL_OUTPUT` has all 5 fields set to `true`
2. `MINIMAL_OUTPUT` has only `includeTranscription: true`, all others `false`
3. `NOTIFICATION_OUTPUT` has `includeExamples: true` and `includeTranscription: true`, all others `false`

**Prompt builder tests (`buildTranslationPrompt` with config):**
4. `includeExamples: false` → prompt has no `"examples"` key in JSON template
5. `includeExamples: false` → prompt has no "VARIETY IN EXAMPLES IS MANDATORY" text
6. `includeExamples: false` → prompt has no "3 example sentences" text
7. `includeTranscription: false` → prompt has no `"transcription"` in language block
8. `includeSynonyms: false` → prompt has no `"synonyms"` in language block
9. `includeSynonyms: false` → prompt has no "Provide 2–3 synonyms" rule
10. `includeAlternatives: false` → prompt has no `"alternatives"` in language block
11. `includeAlternatives: false` → prompt has no "2 alternative translations" rule
12. `includeEquivalentNote: false` → prompt has no `"expressionType"` in language block
13. `includeEquivalentNote: false` → prompt has no "Idiomatic & Proverb Rule" block
14. `{}` (empty config) → prompt is identical to no-config call (all sections present)
15. `undefined` config → prompt is identical to no-config call (all sections present)
16. `MINIMAL_OUTPUT` preset → prompt is a minimal valid JSON structure with just `text`, `cefr`, `register`, `transcription` fields

**Schema tests (`buildTranslationResultSchema` with config):**
17. `{ includeExamples: false }` → schema accepts `{ examples: [] }` (no min(1) error)
18. `{ includeExamples: false }` → schema rejects missing `text` field (required fields still enforced)
19. `{ includeSynonyms: false }` → schema accepts `{ synonyms: [] }` without error
20. Default (no config) → schema still requires non-empty `examples` array (min 1)

**Integration test (service-level):**
21. `translate()` with `outputConfig: MINIMAL_OUTPUT` calls `buildTranslationResultSchema` with the config (mock verifies schema has no min-1 on examples)

**Acceptance criteria:**
- All 21+ new tests pass
- No test imports real AI or DB (fully mocked)
- Tests follow the existing vitest + mock style of the translation test suite

---

### Step 10: Update `.pi/skills/translation/SKILL.md`

Update the skill file to document:
- `TranslationOutputConfig` interface (new type, all fields, defaults)
- Named presets: `FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT` — explain that presets are the single source of truth, not user settings
- Updated `TranslateInput` and `TranslationRequest` with `outputConfig?`
- Updated `buildTranslationResultSchema(targetLangs, config?)` signature
- Caller → preset mapping table
- Rule: **callers must always use a named preset — never construct `TranslationOutputConfig` inline**
- Updated "Current State" note: "Task 21: Added `TranslationOutputConfig` with centralized presets (`FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT`). Prompt builder and schema builder are config-aware. All callers reference a preset — output is managed in one place (`translation-output.presets.ts`), not in user settings."

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Centralized presets in `translation-output.presets.ts` | **Single source of truth** — every caller imports a preset, never constructs config inline. Changing output for a use case = changing one file. |
| NOT user settings | Output config is a product/engineering decision, not a user preference. Users don't need to understand prompt internals. |
| Named presets (`FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT`) | Self-documenting. Each use case maps to exactly one preset. Easy to add new presets for future use cases. |
| Config in `TranslateInput` / `TranslationRequest` | Follows existing pattern (same pipeline carries it from caller to prompt builder) |
| All fields default `true` | 100% backward-compatible — existing callers pass no config and behavior is unchanged |
| Config affects the prompt, not just the renderer | Token efficiency: don't ask AI for things we won't use |
| Config affects the schema validation | Avoids false validation failures when disabled fields are absent in AI response |
| No config in `translateBatch` signature | `translateBatch` already delegates to `translate()` per word; callers can put config in `TranslateInput` |
| Renderer unchanged | Renderer already handles absent optional fields (`examples.length > 0`, etc.) |
| Validation module unchanged | Validation already skips absent fields (examples check: `if (examples && Array.isArray(examples))`) |

---

## Files to Create

| File | Purpose |
|---|---|
| `docs/tasks/21-translation-output-config.md` | This file |
| `packages/core/src/modules/translation/translation-output.presets.ts` | Centralized named presets (`FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT`) — **single source of truth** |
| `packages/core/src/modules/translation/__tests__/output-config.test.ts` | 21+ unit tests for presets, config-aware prompt builder, and schema builder |

## Files to Modify

| File | Change |
|---|---|
| `packages/core/src/modules/translation/types.ts` | Add `TranslationOutputConfig`, add `outputConfig?` to `TranslateInput` + `TranslationRequest` |
| `packages/core/src/modules/translation/index.ts` | Re-export `TranslationOutputConfig` and presets |
| `packages/core/src/modules/translation/prompt.builder.ts` | Make prompt sections conditional on `request.outputConfig` |
| `packages/core/src/modules/translation/schemas/translation.schema.ts` | `buildTranslationResultSchema(targetLangs, config?)`, export `buildLanguageTranslationSchema(config?)` |
| `packages/core/src/modules/translation/translation.service.ts` | Pass `outputConfig` to request and schema builder |
| `packages/core/src/modules/context-enrichment/types.ts` | Verify / document `outputConfig` passthrough via `EnrichedTranslateInput` |
| `apps/bot/src/scenes/helpers/translate-mode.helper.ts` | Import and pass `FULL_OUTPUT` preset |
| `apps/bot/src/scenes/helpers/regen.helper.ts` | Import and pass `FULL_OUTPUT` preset |
| `packages/core/src/modules/topics/topic.service.ts` | Import and pass `MINIMAL_OUTPUT` preset |
| `.pi/skills/translation/SKILL.md` | Document presets, new type, updated function signatures, and "no inline config" rule |

---

## Acceptance Criteria (Summary)

- [x] `TranslationOutputConfig` interface is defined with 5 optional boolean fields, all defaulting to `true`
- [x] `TranslateInput.outputConfig` and `TranslationRequest.outputConfig` are optional (no breaking change)
- [x] `translation-output.presets.ts` exists with `FULL_OUTPUT`, `MINIMAL_OUTPUT`, `NOTIFICATION_OUTPUT` — all exported from `@polyglot/core`
- [x] `buildTranslationPrompt({ ..., outputConfig: { includeExamples: false } })` produces a prompt with no `examples` field and no variety-in-examples rules
- [x] `buildTranslationPrompt({ ..., outputConfig: { includeEquivalentNote: false } })` produces a prompt with no `Idiomatic & Proverb Rule` block
- [x] `buildTranslationResultSchema(langs, { includeExamples: false })` returns a schema that passes validation when `examples` is `[]`
- [x] `translate({ ..., outputConfig: MINIMAL_OUTPUT }, fn)` uses the config-aware prompt and schema end-to-end
- [x] `translateWithContext({ ..., outputConfig: FULL_OUTPUT }, deps)` correctly forwards config to `translate()`
- [x] Every call site uses a named preset — no inline `TranslationOutputConfig` construction in callers
- [x] `topic.service.ts` uses `MINIMAL_OUTPUT`, bot helpers use `FULL_OUTPUT`
- [x] Passing `undefined` config or `{}` config produces behavior identical to today (backward-compatible)
- [x] All existing tests pass: `pnpm test` (zero regressions)
- [x] TypeScript compiles cleanly: `pnpm -r run build`
- [x] At least 20 new unit tests in `output-config.test.ts` (including 3 preset tests)
- [x] `.pi/skills/translation/SKILL.md` updated with presets, new type, updated signatures, and "no inline config" rule
