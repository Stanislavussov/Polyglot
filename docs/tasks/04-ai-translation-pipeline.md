# Task 04: AI Translation Pipeline

**Status:** 🔲 To Do

## Description

Implement the end-to-end AI translation pipeline: fix types & schemas to match the BRD, install AI dependencies, implement the validation module, wire up the AI adapter (Vercel AI SDK), build the prompt builder, and rewrite the translation service to connect all layers. This task covers steps 1–6 from the research agent's recommended implementation order.

**References:**
- `BRD.md` § 6.1 (Word/Phrase Translation), § 10 (AI Integration & Response Schema)
- `tech-reqs/06-ai-adapter.md` (adapter pattern)
- `tech-reqs/07-ai-validation.md` (multi-level validation)
- `tech-reqs/08-ai-prompt.md` (prompt structure)
- `tech-reqs/14-agents.md` (agent contracts)
- `tech-reqs/13-env.md` (env config)

## Subtasks

### Step 1: Fix Types & Zod Schemas

- [ ] Rewrite `packages/core/src/modules/translation/types.ts`:
  - `TranslationRequest`: `text`, `sourceLang`, `targetLangs: string[]` (array, not single), `topic?`
  - `TranslationResult`: full multi-language structure matching BRD § 10 AI Response Schema:
    - `emoji: string`
    - `register: Register` (`"slang" | "colloquial" | "neutral" | "literary" | "professional"`)
    - `translations: Record<string, LanguageTranslation>`
  - `LanguageTranslation`: `text`, `cefr: CefrLevel` (A1–C2), `transcription?`, `register`, `synonyms: Synonym[]`, `examples: Example[]`
  - `Synonym`: `text`, `register`
  - `Example`: `context` (`"formal" | "colloquial" | "professional"`), `target`, `native`
- [ ] Rewrite `packages/core/src/modules/translation/schemas/translation.schema.ts`:
  - `translationRequestSchema` — validates the new `TranslationRequest` (targetLangs as array, min 1, max 4)
  - `translationResultSchema` — validates the full AI response structure (emoji, register, translations map with cefr, synonyms, examples)
  - Export inferred types from schemas for runtime validation

### Step 2: Install Dependencies

- [ ] In `packages/adapters/ai/`: `pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google`
  - **Alternative (recommended by research):** `pnpm add ai @openrouter/ai-sdk-provider` for single-API-key provider switching
- [ ] In `packages/core/`: `pnpm add franc-min` for language detection validation
- [ ] Verify all workspace packages still build after dependency changes (`pnpm -r run build`)

### Step 3: Implement Validation Module

- [ ] Create `packages/core/src/modules/validation/validators/schema.validator.ts`:
  - `validateSchema(raw: unknown, schema: ZodSchema): ValidationResult` — Zod parse, returns field-level errors
- [ ] Create `packages/core/src/modules/validation/validators/semantic.validator.ts`:
  - `validateSemantic(original: string, translation: LanguageTranslation): ValidationResult`
  - Rules: translation ≠ original, no hallucination patterns ("N/A", "I cannot", "—", empty strings)
- [ ] Create `packages/core/src/modules/validation/validators/language.validator.ts`:
  - `validateLanguage(text: string, expectedLang: string): ValidationResult` — uses `franc-min`
  - Skip validation for short text (<15 chars) — franc accuracy too low
- [ ] Create `packages/core/src/modules/validation/validators/example.validator.ts`:
  - `validateExamples(examples: Example[], word: string): ValidationResult`
  - Rules: examples contain the translated word, have both target and native text
- [ ] Create `packages/core/src/modules/validation/index.ts`:
  - `validate(raw: unknown, schema: ZodSchema, original: string, expectedLangs: string[]): ValidationResult` — orchestrates all validators
- [ ] Update `packages/core/src/modules/validation/types.ts` if needed (current types look correct)

### Step 4: Implement AI Adapter (`packages/adapters/ai/src/`)

- [ ] Create `packages/adapters/ai/src/types.ts` — `AIModel`, `AIRequestLog` interfaces
- [ ] Create `packages/adapters/ai/src/client.ts`:
  - Provider factory based on `AI_PROVIDER` env var (via `loadConfig()` from `@polyglot/infra`)
  - Returns Vercel AI SDK model instance (`openai("gpt-4o")`, `anthropic("claude-sonnet-4-20250514")`, etc.)
- [ ] Create `packages/adapters/ai/src/models.ts`:
  - Model registry with cost data per provider
  - `getAvailableModels(): AIModel[]`
  - `estimateCost(tokens: number, model: string): number`
- [ ] Create `packages/adapters/ai/src/logger.ts`:
  - Logs every request: `model`, `tokens.input`, `tokens.output`, `cost_usd`, `duration_ms`, `success`, `error?`
  - Uses `logger` from `@polyglot/infra`
- [ ] Create `packages/adapters/ai/src/index.ts`:
  - `generateObject<T>(prompt, schema, model, options?)` — calls Vercel AI SDK `generateObject`, logs result
  - `generateText(prompt, model, options?)` — calls Vercel AI SDK `generateText`, logs result
  - Re-exports `getAvailableModels`, `estimateCost`
  - `maxRetries` configurable via `options` parameter (default: 2)

### Step 5: Rewrite Prompt Builder

- [ ] Rewrite `packages/core/src/modules/translation/prompt.builder.ts` (or create if missing):
  - `buildTranslationPrompt(request: TranslationRequest): string`
  - Multi-language prompt: translate `{text}` from `{sourceLang}` to ALL `{targetLangs}` in a single request
  - Prompt requests: emoji, register, CEFR level, transcription, synonyms with register, example sentences (formal/colloquial/professional)
  - Output format matches `translationResultSchema` exactly (JSON, no markdown)

### Step 6: Rewrite Translation Service

- [ ] Rewrite `packages/core/src/modules/translation/translation.service.ts` (or create if missing):
  - `translate(request: TranslationRequest): Promise<TranslationResult>` — single entry point
  - `translateBatch(words: string[], sourceLang: string, targetLangs: string[]): Promise<TranslationResult[]>`
  - Flow per `tech-reqs/07-ai-validation.md`:
    1. Build prompt (`buildTranslationPrompt`)
    2. Call AI adapter (`generateObject` with `translationResultSchema`)
    3. Validate response (`validate` from validation module)
    4. On PASS → return result
    5. On FAIL → retry with strict prompt (up to 2 retries)
    6. On final FAIL → return result with `needsReview: true` + warning flag
  - Does NOT save results — only returns them
  - Knows nothing about the user — works only with text and languages
- [ ] Update `packages/core/src/index.ts` to re-export the translation public API

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `franc-min` low accuracy on short text (<15 chars) | Skip language validation for inputs shorter than 15 characters |
| CEFR level non-determinism from AI | Accept AI's CEFR as-is in MVP; add user override in post-MVP |
| Provider lock-in | Use adapter pattern; consider OpenRouter for single-API-key flexibility |
| Schema mismatch between prompt output and Zod schema | `translationResultSchema` is the single source of truth — prompt and types are derived from it |

## Files Created / Modified

### Created
- `packages/core/src/modules/validation/validators/schema.validator.ts`
- `packages/core/src/modules/validation/validators/semantic.validator.ts`
- `packages/core/src/modules/validation/validators/language.validator.ts`
- `packages/core/src/modules/validation/validators/example.validator.ts`
- `packages/core/src/modules/validation/index.ts`
- `packages/adapters/ai/src/types.ts`
- `packages/adapters/ai/src/client.ts`
- `packages/adapters/ai/src/models.ts`
- `packages/adapters/ai/src/logger.ts`
- `packages/core/src/modules/translation/prompt.builder.ts`

### Modified
- `packages/core/src/modules/translation/types.ts` — rewritten to multi-lang structure
- `packages/core/src/modules/translation/schemas/translation.schema.ts` — rewritten to match BRD schema
- `packages/core/src/modules/translation/translation.service.ts` — rewritten with validation pipeline
- `packages/core/src/modules/validation/types.ts` — updated if needed
- `packages/core/src/index.ts` — re-exports updated
- `packages/adapters/ai/src/index.ts` — implemented (was empty `export {}`)
- `packages/adapters/ai/package.json` — new dependencies
- `packages/core/package.json` — new dependency (franc-min)

## Acceptance Criteria

- [ ] `TranslationRequest.targetLangs` is an array; `TranslationResult` matches BRD § 10 schema (emoji, CEFR, register, synonyms, examples per language)
- [ ] All Zod schemas validate correctly against sample AI responses
- [ ] Validation module passes: schema check, semantic check (translation ≠ original, no hallucinations), language detection (skipped for <15 chars), example quality check
- [ ] AI adapter connects to configured provider and returns typed responses
- [ ] Every AI request is logged with model, tokens, cost, duration
- [ ] `translate()` returns a full multi-language result for a test word (e.g. "hello" → Czech + English)
- [ ] Validation failures trigger retry (up to 2), then return with `needsReview: true`
- [ ] All packages build successfully (`pnpm -r run build`)
- [ ] All tests pass (`pnpm test`) — each agent writes tests for its own module
