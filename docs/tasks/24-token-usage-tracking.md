# Task 24: Track Token Usage Per Request with Approximate Cost

**Status:** 🔲 To Do

## Description

Surface token usage and approximate cost from the AI adapter through the translation pipeline up to the caller (bot layer). Currently, `generateObject`/`generateText` log tokens to pino but discard usage metadata — callers receive only the result object/text with no visibility into how many tokens were consumed or what it cost.

This task adds a `UsageInfo` return channel so that every translation request carries its cumulative token usage (including retries), and optionally displays an approximate cost/token summary to the user in the translation card.

**References:**
- `docs/tech-reqs/06-ai-adapter.md` (AI adapter pattern)
- `docs/tech-reqs/07-ai-validation.md` (validation pipeline with retries)
- `docs/tech-reqs/02-architecture.md` (layer separation)
- `docs/tasks/06-token-optimization.md` (token reduction — complementary task)

---

## Current State

| Layer | Token awareness | Gap |
|---|---|---|
| **AI adapter** (`packages/adapters/ai/src/index.ts`) | ✅ Has `result.usage.inputTokens`/`outputTokens`, calculates `cost_usd`, logs via pino | Returns only `T` / `string` — usage is discarded |
| **Translation service** (`packages/core/src/modules/translation/translation.service.ts`) | ❌ No token tracking | Cannot aggregate tokens across retries |
| **Bot layer** (`apps/bot/src/scenes/helpers/translate-mode.helper.ts`) | ❌ No usage info | Cannot show usage to user |
| **Renderer** (`apps/bot/src/renderers/translation.renderer.ts`) | ❌ No usage rendering | — |

---

## Subtasks

### Step 1: Add `UsageInfo` type and return it from AI adapter

Extend `generateObject` and `generateText` to return usage metadata alongside the result, without breaking existing callers.

- [ ] In `packages/adapters/ai/src/types.ts`, add:
  ```typescript
  /** Token usage and cost for a single AI call */
  export interface UsageInfo {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost_usd: number;
    model: string;
    duration_ms: number;
  }

  /** Result wrapper that includes both the value and usage metadata */
  export interface AIResult<T> {
    value: T;
    usage: UsageInfo;
  }
  ```
- [ ] In `packages/adapters/ai/src/index.ts`, add new functions alongside existing ones (non-breaking):
  ```typescript
  /** Like generateObject, but returns usage metadata alongside the result */
  export async function generateObjectWithUsage<T>(
    prompt: string,
    schema: ZodSchema<T>,
    model: string,
    options?: GenerateOptions,
  ): Promise<AIResult<T>>;

  /** Like generateText, but returns usage metadata alongside the result */
  export async function generateTextWithUsage(
    prompt: string,
    model: string,
    options?: GenerateOptions,
  ): Promise<AIResult<string>>;
  ```
- [ ] Export `UsageInfo` and `AIResult` from `packages/adapters/ai/src/index.ts`
- [ ] Existing `generateObject` / `generateText` remain unchanged — no breaking change
- [ ] Add tests in `packages/adapters/ai/src/__tests__/index.test.ts` for the new `*WithUsage` functions

### Step 2: Add `usageInfo` to `TranslateOutput` and aggregate across retries

Thread token usage through the translation service, summing tokens across all AI calls (including retries).

- [ ] In `packages/core/src/modules/translation/types.ts`, add:
  ```typescript
  /** Aggregated token usage for a translation request (may span multiple AI calls) */
  export interface TranslationUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost_usd: number;
    /** Number of AI calls made (1 = no retries, 2 = one retry, etc.) */
    aiCalls: number;
    model: string;
    duration_ms: number;
  }
  ```
- [ ] Add optional `usage?: TranslationUsage` field to `TranslateOutput`
- [ ] In `packages/core/src/modules/translation/translation.service.ts`:
  - Update `GenerateObjectFn` type to optionally return usage:
    ```typescript
    export type GenerateObjectFn = <T>(
      prompt: string,
      schema: import("zod").ZodSchema<T>,
      model: string,
      options?: { userId?: number },
    ) => Promise<T | { value: T; usage: { inputTokens: number; outputTokens: number; totalTokens: number; cost_usd: number; model: string; duration_ms: number } }>;
    ```
  - Or preferably, add a separate `GenerateObjectWithUsageFn` type and accept it as an optional parameter
  - In the `translate()` retry loop, accumulate `inputTokens`, `outputTokens`, `cost_usd`, `duration_ms`, and `aiCalls` across all attempts
  - Attach aggregated `usage` to the returned `TranslateOutput`
- [ ] Update `toOutput()` helper to include usage
- [ ] Update tests in `packages/core/src/modules/translation/__tests__/translation.service.test.ts`

### Step 3: Surface usage in the translation card (bot layer)

Display approximate token usage and cost in the Telegram translation card — useful for transparency and debugging.

- [ ] In `apps/bot/src/renderers/translation.renderer.ts`:
  - Add a `renderUsageFooter(usage: TranslationUsage, lang: SupportedLang): string` function
  - Format: `📊 ~{totalTokens} tokens · ~${cost_usd} · {aiCalls} call(s) · {duration_ms}ms`
  - Only render if `usage` is present on the `TranslateOutput`
  - Append footer to the existing translation card in `renderTranslation()`
- [ ] In `apps/bot/src/scenes/helpers/translate-mode.helper.ts`:
  - Pass `generateObjectWithUsage` (from `@polyglot/adapter-ai`) instead of `generateObject` to get usage data flowing
  - No other changes needed — the renderer picks up `output.usage` automatically
- [ ] Add i18n key for the usage footer label (optional — can be a simple static string since it's developer/power-user info)
- [ ] Update renderer tests in `apps/bot/src/__tests__/translation.renderer.test.ts`

### Step 4: Log aggregated usage per translation (structured logging)

Enhance the existing pino logging with a summary log entry per translation that includes total tokens across retries.

- [ ] In `packages/core/src/modules/translation/translation.service.ts`:
  - After `translate()` completes (success or needsReview), emit a `console.info` with the aggregated usage:
    ```
    [translation] completed { original, sourceLang, targetLangs, totalTokens, cost_usd, aiCalls, duration_ms }
    ```
  - This is in addition to the per-call logs already emitted by the AI adapter
- [ ] In the bot layer (or wherever a pino logger is available), log the same aggregated usage via `logger.info`

---

## Architecture Constraints

| Package | Change scope | Notes |
|---|---|---|
| `packages/adapters/ai/` | New `*WithUsage` functions + `UsageInfo`/`AIResult` types | Non-breaking — existing functions unchanged |
| `packages/core/src/modules/translation/` | `TranslationUsage` type, aggregate in retry loop, attach to output | Core stays infra-free — no pino dependency |
| `apps/bot/src/` | Pass `generateObjectWithUsage`, render usage footer | Thin integration |
| `packages/core/src/modules/i18n/` | Optional: new i18n keys for usage footer | Minimal |

---

## Files Modified

- `packages/adapters/ai/src/types.ts` — add `UsageInfo`, `AIResult<T>`
- `packages/adapters/ai/src/index.ts` — add `generateObjectWithUsage`, `generateTextWithUsage`, export new types
- `packages/core/src/modules/translation/types.ts` — add `TranslationUsage`, add `usage?` to `TranslateOutput`
- `packages/core/src/modules/translation/translation.service.ts` — accumulate usage across retries, attach to output
- `apps/bot/src/renderers/translation.renderer.ts` — `renderUsageFooter()`, append to card
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — use `generateObjectWithUsage`
- Test files for all above modules

---

## Expected Impact

- **Visibility:** Every translation request carries exact token count and approximate cost
- **Debugging:** Easier to identify expensive requests (many retries, large prompts)
- **User transparency:** Users see approximate resource usage per translation
- **No performance impact:** Usage data is already computed in the AI adapter — just needs to be returned instead of discarded
- **Non-breaking:** Existing `generateObject`/`generateText` signatures are preserved

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Breaking existing `GenerateObjectFn` type contract | Add new `*WithUsage` variants instead of modifying existing functions; callers opt in |
| Usage display clutters the translation card | Make it a compact single-line footer; consider a user setting to hide it in the future |
| Cost estimates are approximate (model registry may be stale) | Label as "approximate" (~$0.003); add a note that actual billing may differ |
| Token counts unavailable for some providers | `UsageInfo` fields default to 0 when `result.usage` is undefined (already handled in AI adapter) |

---

## Acceptance Criteria

- [ ] `generateObjectWithUsage` returns `AIResult<T>` with `value` and `usage` fields
- [ ] `generateTextWithUsage` returns `AIResult<string>` with `value` and `usage` fields
- [ ] `TranslateOutput` has an optional `usage: TranslationUsage` field
- [ ] Token counts are accumulated across retries (e.g., 2 AI calls → summed tokens)
- [ ] `TranslationUsage.aiCalls` correctly counts the number of AI calls made
- [ ] Translation card in Telegram shows approximate token count and cost when usage is present
- [ ] Existing `generateObject` / `generateText` signatures are unchanged (non-breaking)
- [ ] All existing tests pass: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
- [ ] New tests cover: `*WithUsage` functions, usage aggregation in translation service, usage rendering
