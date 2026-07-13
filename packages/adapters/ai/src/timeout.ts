/**
 * AI request time budget — the wall-clock limit for a single AI call (including
 * the SDK's internal retries) before it is aborted. Without this a hung upstream
 * (e.g. a rate-limited model returning slow 429s) would hold a socket and a
 * provider concurrency slot indefinitely; the abort frees both instead of
 * letting them pile up under load.
 *
 * The budget is admin-managed (stored in the DB `system_settings` `ai.defaults`
 * row, editable in the admin panel). The adapter must not depend on the settings
 * service directly, so the composition root injects a provider via
 * `setAIRequestTimeoutProvider` — the same dependency-injection pattern used for
 * the metric sink. When no provider is wired (tests, benchmark CLI) the default
 * applies.
 */

import { isFinitePositive } from "@polyglot/core";

/** Fallback budget used when no provider is injected or it yields an invalid value. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Resolves the current per-request budget in ms. May be async (DB-backed, cached). */
export type AIRequestTimeoutProvider = () => number | Promise<number>;

let provider: AIRequestTimeoutProvider | null = null;

/**
 * Injects the source of the per-request time budget. Pass `null` to reset to the
 * built-in default (e.g. between tests).
 */
export function setAIRequestTimeoutProvider(next: AIRequestTimeoutProvider | null): void {
  provider = next;
}

/**
 * Resolves the current budget, falling back to {@link DEFAULT_REQUEST_TIMEOUT_MS}
 * when no provider is wired, it throws, or it yields a non-positive/NaN value —
 * a misconfigured setting must never disable the timeout entirely.
 */
export async function resolveRequestTimeoutMs(): Promise<number> {
  if (!provider) return DEFAULT_REQUEST_TIMEOUT_MS;
  try {
    const ms = await provider();
    return isFinitePositive(ms) ? ms : DEFAULT_REQUEST_TIMEOUT_MS;
  } catch {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
}

export interface RequestTimeout {
  /** Signal to pass to the AI SDK; fires (aborting the request) at the budget. */
  readonly signal: AbortSignal;
  /** True once the budget elapsed — lets callers tell a timeout from other errors. */
  timedOut(): boolean;
  /** Cancels the pending timer; call in `finally` so it never outlives the call. */
  clear(): void;
}

/**
 * Builds an AbortSignal that fires after `budgetMs`, cancelling the in-flight
 * request and any pending SDK retries. One signal covers the whole call, so the
 * total wall-clock is bounded regardless of `maxRetries`.
 */
export function createRequestTimeout(budgetMs: number): RequestTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, budgetMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => clearTimeout(timer),
  };
}
