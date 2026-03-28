# Task 05: Structured Logging (Console / stdout)

**Status:** ✅ Done

## Description

Wire up structured logging across all layers for the four mandatory event types defined in `tech-reqs/16-logging.md`. This task uses **console / Pino stdout only** — no external log service, no log storage. Betterstack integration is intentionally deferred to a future task.

**References:**
- `tech-reqs/16-logging.md` (event catalogue and field spec)
- `tech-reqs/14-agents.md` (agent boundaries — core must not import infra)
- `tech-reqs/13-env.md` (env config)

---

## Current State vs. Required

| Mandatory Event | Required Fields | Status |
|---|---|---|
| AI request | `model`, `tokens_used`, `cost_usd`, `duration_ms`, `userId` | ⚠️ Partial — `userId` missing |
| Validation error | `original`, `aiResponse`, `failReason`, `retryCount` | ❌ Not logged |
| Notification sent | `userId`, `type`, `wordId` | ❌ Not logged (adapter stub only) |
| Bot error | `error`, `userId`, `command` | ⚠️ Partial — `userId` + `command` missing |

Additional issue: `packages/infra/src/logger.ts` conditionally references `@logtail/pino` (not installed). Must be stripped for a clean console-only logger.

---

## Subtasks

### Step 1: Fix `packages/infra/src/logger.ts` — console/stdout only

- [x] Remove the Betterstack conditional transport entirely
- [x] Always use `pino({ level: 'info' }, pino.destination(1))` — stdout only
- [x] Add `pino` to `packages/infra/package.json` dependencies (currently only at workspace root — make it explicit)
- [x] Logger API stays unchanged: `logger.info(...)`, `logger.warn(...)`, `logger.error(...)` — no call sites need updating

```ts
// packages/infra/src/logger.ts (new)
import pino from 'pino';

export const logger = pino({ level: 'info' }, pino.destination(1));
```

### Step 2: Add `userId` to AI request logs

- [x] In `packages/adapters/ai/src/types.ts` — add optional `userId?: number` to `AIRequestLog`:
  ```ts
  export interface AIRequestLog {
    model: string;
    tokens: { input: number; output: number };
    cost_usd: number;
    duration_ms: number;
    success: boolean;
    userId?: number;   // ← new
    error?: string;
  }
  ```
- [x] In `packages/adapters/ai/src/types.ts` — add optional `userId?: number` to `GenerateOptions`:
  ```ts
  export interface GenerateOptions {
    maxRetries?: number;
    userId?: number;   // ← new
  }
  ```
- [x] In `packages/adapters/ai/src/index.ts` — thread `options?.userId` into `logRequest()` calls (both `generateObject` and `generateText`)
- [x] In `packages/adapters/ai/src/logger.ts` — include `userId` in the pino log object when present:
  ```ts
  aiLogger.info({ model, inputTokens, outputTokens, cost_usd, duration_ms, ...(userId !== undefined && { userId }) }, 'AI request completed');
  ```

### Step 3: Log validation errors in translation service

> **Architecture note:** `packages/core` has no dependency on `@polyglot/infra` and must not get one (clean arch). Use `console.warn` directly — acceptable for MVP console-only logging.

- [x] In `packages/core/src/modules/translation/translation.service.ts`, after each failed validation attempt, add:
  ```ts
  // Log validation failure (console — core has no logger dep)
  console.warn('[translation] validation failed', {
    original: input.word,
    retryCount: attempt,
    failReason: lastErrors.join(' | '),
  });
  ```
- [x] After exhausting all retries (final FAIL), log with `console.error`:
  ```ts
  console.error('[translation] validation failed after all retries — returning needsReview', {
    original: input.word,
    retryCount: MAX_RETRIES,
    failReason: lastErrors.join(' | '),
  });
  ```
- [x] Fields to log per spec: `original`, `failReason`, `retryCount`. `aiResponse` is large — log only `Object.keys(result.translations)` to avoid flooding stdout.

### Step 4: Fix bot error handler — add `userId` and `command`

- [x] In `apps/bot/src/index.ts`, update `bot.catch` to extract `userId` and `command`:
  ```ts
  bot.catch((err) => {
    const ctx = err.ctx;
    const userId = ctx.from?.id;
    const command = ctx.message?.text?.split(' ')[0] ?? 'unknown';
    logger.error(
      { error: err.error instanceof Error ? err.error.message : String(err.error), userId, command },
      'Bot error'
    );
  });
  ```

### Step 5: Stub notification-sent logging in notifications adapter

- [x] In `packages/adapters/notifications/src/index.ts`, replace `export {};` with a logging-ready stub:
  ```ts
  import { logger } from '@polyglot/infra';

  /**
   * Log a successfully dispatched notification.
   * Called by the scheduler after each successful send.
   */
  export function logNotificationSent(params: {
    userId: number;
    type: 'suggested' | 'srs';  // BUG-07 fix: expanded to include SRS notification type per BRD §2.5
    wordId: number;
  }): void {
    logger.info(params, 'Notification sent');
  }
  ```
- [x] This creates the logging contract ready for the full notifications implementation (Task 06 or later)

---

## Architecture Constraints

| Package | Logging approach | Reason |
|---|---|---|
| `packages/infra` | Pino (stdout only) | Logger home — no deps issue |
| `packages/adapters/ai` | `logger` from `@polyglot/infra` | Already in its dep graph |
| `packages/adapters/notifications` | `logger` from `@polyglot/infra` | Adapter layer — infra dep OK |
| `apps/bot` | `logger` from `@polyglot/infra` | App layer — infra dep OK |
| `packages/core` | `console.warn` / `console.error` | Core must stay infra-free; raw console acceptable for MVP |

---

## Files Created / Modified

### Modified
- `packages/infra/src/logger.ts` — remove Betterstack conditional, stdout-only
- `packages/infra/package.json` — add explicit `pino` dependency
- `packages/adapters/ai/src/types.ts` — add `userId` to `AIRequestLog` and `GenerateOptions`
- `packages/adapters/ai/src/index.ts` — thread `userId` through `logRequest()` calls
- `packages/adapters/ai/src/logger.ts` — include `userId` in pino log object
- `packages/core/src/modules/translation/translation.service.ts` — add `console.warn/error` on validation failures
- `apps/bot/src/index.ts` — fix `bot.catch` to log `userId` + `command`

### Created
- `packages/adapters/notifications/src/index.ts` — replace empty stub with `logNotificationSent()` function

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `console.warn` in core looks inconsistent with Pino elsewhere | Acceptable for MVP; can inject logger interface in post-MVP |
| `userId` not always available in bot error context (non-message updates) | Use `ctx.from?.id ?? undefined` — field is optional in spec |
| Pino not declared in `infra/package.json` — works via hoisting but fragile | Add explicit `pino` dep to infra |
| Notification logging stub never called until notifications task is implemented | Stub documents the contract early; no runtime risk |

---

## Acceptance Criteria

- [x] `packages/infra/src/logger.ts` has no reference to Betterstack or `@logtail/pino`
- [x] Starting the bot in dev mode prints structured JSON to stdout (no errors)
- [x] A successful AI request logs: `model`, `inputTokens`, `outputTokens`, `cost_usd`, `duration_ms`, `userId` (when provided)
- [x] A validation failure in the translation service prints a `console.warn` with `original`, `failReason`, `retryCount`
- [x] A bot error (triggered by throwing inside a handler) logs `error`, `userId`, `command`
- [x] `logNotificationSent()` is exported from `@polyglot/adapter-notifications` and compiles without errors
- [x] All packages build successfully: `pnpm -r run build`
- [x] All tests pass: `pnpm test`
