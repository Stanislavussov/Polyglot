# Task 08: AI Model Fallback on Service Unavailability

**Status:** 🔲 To Do

## Description

When the primary AI model is unavailable (503, 429 rate-limit, timeout, or provider outage), the system currently fails the request after `maxRetries` and surfaces an error to the user. Implement an automatic **model fallback chain** so that when the primary model doesn't respond, the adapter transparently retries with a fallback model before giving up.

**References:**

- `tech-reqs/06-ai-adapter.md` (AI adapter pattern)
- `tech-reqs/13-env.md` (env config)
- `tech-reqs/14-agents.md` (agent contracts)

---

## Root Cause

OpenRouter proxies to upstream providers. Any single provider can experience:

- **503 Service Unavailable** — model overloaded or temporarily down
- **429 Too Many Requests** — rate limit hit on provider side
- **Timeouts** — response takes >30s, request aborted
- **Regional outages** — entire provider unreachable for minutes/hours

Currently `generateObject` / `generateText` in `packages/adapters/ai/src/index.ts` retry the **same model** up to `maxRetries` times. If the provider itself is down, all retries fail identically.

---

## Subtasks

### Step 1: Define the fallback chain configuration

- [ ] In `packages/adapters/ai/src/types.ts`:
  - Add `FallbackConfig` type:
    ```typescript
    interface FallbackConfig {
      /** Ordered list of model IDs to try after the primary model fails */
      models: string[];
      /** HTTP status codes that trigger fallback (default: [429, 502, 503, 504]) */
      triggerOn?: number[];
      /** Also trigger fallback on timeout errors (default: true) */
      fallbackOnTimeout?: boolean;
    }
    ```
  - Extend `GenerateOptions` with an optional `fallback?: FallbackConfig`
- [ ] In `packages/adapters/ai/src/models.ts`:
  - Add a default fallback chain constant:
    ```typescript
    export const DEFAULT_FALLBACK_CHAIN: string[] = [
      "openai/gpt-5-nano",
      "anthropic/claude-haiku-4-20250514",
      "google/gemini-2.5-flash",
    ];
    ```
  - Add `getFallbackChain(primaryModel: string): string[]` that returns the default chain **excluding** the primary model (to avoid retrying the same model)

### Step 2: Implement fallback logic in the AI adapter

- [ ] Create `packages/adapters/ai/src/fallback.ts`:
  - `isRetryableError(error: unknown, triggerOn?: number[]): boolean` — checks if an error is a retryable service error:
    - HTTP status in `triggerOn` (default `[429, 502, 503, 504]`)
    - Timeout / network errors (check `error.code === 'ETIMEDOUT'` or `error.name === 'AbortError'`)
    - OpenRouter-specific error codes if applicable
  - `withFallback<T>(fn: (model: string) => Promise<T>, primaryModel: string, config: FallbackConfig): Promise<T>`:
    1. Try `fn(primaryModel)` — if succeeds, return
    2. If fails with a retryable error, log a warning and iterate through `config.models`
    3. Try each fallback model in order — return the first success
    4. If all models exhausted, throw the **last** error (with context about all attempted models)
- [ ] Add structured logging for each fallback attempt:
  ```typescript
  logger.warn({
    event: "model_fallback",
    primaryModel,
    failedModel: currentModel,
    fallbackModel: nextModel,
    error: errorMessage,
    attempt: attemptNumber,
  });
  ```

### Step 3: Integrate fallback into generateObject and generateText

- [ ] In `packages/adapters/ai/src/index.ts`:
  - Wrap the core AI SDK call inside `withFallback()` when `options.fallback` is provided
  - When no explicit `fallback` is passed, use a **default fallback** from env:
    - `AI_FALLBACK_MODELS` env var — comma-separated list of model IDs (optional)
    - If env is set, auto-construct `FallbackConfig` from it
    - If env is not set and no explicit fallback — current behavior (no fallback)
  - Log the final model used in `AIRequestLog` so we can track fallback frequency:
    - Add `fallbackUsed?: boolean` and `originalModel?: string` to `AIRequestLog`
- [ ] Ensure the logged cost uses the **actual model's** pricing, not the primary model's

### Step 4: Add env configuration

- [ ] In `packages/infra/src/config.ts` (or equivalent config module):
  - Add `AI_FALLBACK_MODELS` — optional comma-separated list of fallback model IDs
  - Add `AI_FALLBACK_TIMEOUT_MS` — timeout per model attempt before triggering fallback (default: `30000`)
- [ ] Update `.env.example` with the new variables:
  ```env
  # AI Model Fallback (optional — comma-separated OpenRouter model IDs)
  # AI_FALLBACK_MODELS=anthropic/claude-haiku-4-20250514,google/gemini-2.5-flash
  # AI_FALLBACK_TIMEOUT_MS=30000
  ```

### Step 5: Write tests

- [ ] Create `packages/adapters/ai/src/__tests__/fallback.test.ts`:
  - Test `isRetryableError` with various error shapes (503, 429, timeout, non-retryable 400/401)
  - Test `withFallback` happy path (primary succeeds → no fallback)
  - Test `withFallback` with primary failure → first fallback succeeds
  - Test `withFallback` with primary + first fallback failure → second fallback succeeds
  - Test `withFallback` with all models failing → throws last error with context
  - Test non-retryable error on primary → throws immediately, no fallback attempted
  - Test `getFallbackChain` excludes primary model
- [ ] Update `packages/adapters/ai/src/__tests__/index.test.ts`:
  - Test `generateObject` with explicit `fallback` option
  - Test `generateObject` with `AI_FALLBACK_MODELS` env auto-fallback
  - Test `generateText` with fallback
  - Test `AIRequestLog` includes `fallbackUsed` and `originalModel` when fallback is triggered
  - Test cost calculation uses the actual model's pricing after fallback

---

## Architecture Constraints

| Package                 | Change scope                    | Notes                                      |
| ----------------------- | ------------------------------- | ------------------------------------------ |
| `packages/adapters/ai/` | Fallback logic, config, logging | Only package that changes                  |
| `packages/core/`        | No changes                      | Translation/validation unaware of fallback |
| `packages/infra/`       | Env config for fallback models  | Config only                                |
| `apps/bot/`             | No changes                      | Transparent to consumer                    |

The fallback is **fully encapsulated** in the AI adapter — no upstream modules need changes. From `translation`'s perspective, `generateObject` either returns a result or throws, same as before.

---

## Files Created/Modified

- `packages/adapters/ai/src/types.ts` — add `FallbackConfig`, extend `GenerateOptions`, extend `AIRequestLog`
- `packages/adapters/ai/src/models.ts` — add `DEFAULT_FALLBACK_CHAIN`, `getFallbackChain()`
- `packages/adapters/ai/src/fallback.ts` — **new** — `isRetryableError()`, `withFallback()`
- `packages/adapters/ai/src/index.ts` — integrate fallback into `generateObject` / `generateText`
- `packages/adapters/ai/src/logger.ts` — add fallback event logging
- `packages/adapters/ai/src/__tests__/fallback.test.ts` — **new** — fallback unit tests
- `packages/adapters/ai/src/__tests__/index.test.ts` — add fallback integration tests
- `packages/infra/src/config.ts` — add `AI_FALLBACK_MODELS`, `AI_FALLBACK_TIMEOUT_MS`
- `.env.example` — add fallback env vars

---

## Key Risks & Mitigations

| Risk                                           | Mitigation                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Fallback model produces lower quality output   | Fallback chain is ordered by quality — best alternatives first; `needsReview` from validation still applies           |
| Fallback adds latency (serial model attempts)  | Each attempt has its own timeout (`AI_FALLBACK_TIMEOUT_MS`); total worst-case = N × timeout, but avoids total failure |
| Cost surprises (fallback model more expensive) | Log actual model + cost per request; `estimateCost()` already takes model as parameter                                |
| Fallback hides persistent outages              | Structured logging with `model_fallback` event enables monitoring/alerting on fallback frequency                      |
| Rate limits cascade across models              | Each OpenRouter model has independent rate limits; unlikely to hit all simultaneously                                 |

---

## Acceptance Criteria

- [ ] `FallbackConfig` type defined with `models`, `triggerOn`, and `fallbackOnTimeout` fields
- [ ] `withFallback()` correctly iterates through fallback models on retryable errors
- [ ] Non-retryable errors (400, 401, 422) throw immediately without attempting fallback
- [ ] `generateObject` and `generateText` support explicit `fallback` option
- [ ] `AI_FALLBACK_MODELS` env var auto-configures fallback when no explicit config is passed
- [ ] `AIRequestLog` includes `fallbackUsed` and `originalModel` when a fallback model was used
- [ ] Cost is calculated using the **actual** model's pricing, not the primary model's
- [ ] Structured log with event `model_fallback` is emitted on each fallback attempt
- [ ] All new and existing tests pass: `pnpm test`
- [ ] All packages build: `pnpm -r run build`
