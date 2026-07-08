/**
 * AI fallback-model failover (bot self-healing Phase 2).
 *
 * A QUALITY UPGRADE, not a freeze fix: the per-request abort budget already
 * bounds a hung provider ({@link import("./timeout.js")}) and surfaces an
 * `AITimeoutError`. This module upgrades that surfaced error — or a transient
 * provider failure (429 / 5xx / network) — into a *successful* reply on a second
 * model instead of a user-facing error.
 *
 * The budget split is fixed up front (see {@link withModelFailover}); there is no
 * shared-remaining-budget arithmetic. The primary attempt runs bounded by
 * `primaryBudgetMs`, and on a retriable failure the fallback model runs bounded by
 * `reservedFallbackMs`. Because `primaryBudgetMs + reservedFallbackMs <= B` (the
 * clamped request budget), a hung primary is aborted with time still left for the
 * fallback, so BOTH attempts fit inside the outer op guard.
 */

import { AITimeoutError } from "@polyglot/core";

/** HTTP statuses worth retrying on a *different* model: rate limits, gateway/upstream failures, timeouts. */
const RETRIABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Coarse, bounded reason label for the `bot_ai_fallback_total` metric. Kept to a
 * fixed small set so the metric never explodes in cardinality.
 */
export type FallbackReason = "timeout" | "rate_limit" | "server_error" | "network";

/** Reads a numeric `statusCode` off an unknown error without an `any` cast. */
function readStatusCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const status = (error as { statusCode: unknown }).statusCode;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/**
 * Classifies a provider error as retriable-on-another-model and returns the metric
 * reason, or `null` when the error is NOT retriable. Deliberately does not match
 * client errors (400/401/404) or schema/validation failures: switching model will
 * not fix those, and masking them would hide real bugs.
 */
export function retriableReason(error: unknown): FallbackReason | null {
  if (error == null) return null;

  // The adapter's own abort budget surfaced first — the archetypal failover trigger.
  if (error instanceof AITimeoutError) return "timeout";

  // Vercel AI SDK APICallError / fetch errors carry a numeric statusCode.
  const status = readStatusCode(error);
  if (status !== undefined && RETRIABLE_STATUS.has(status)) {
    if (status === 429) return "rate_limit";
    if (status === 408) return "timeout";
    return "server_error";
  }

  if (error instanceof Error) {
    // AbortSignal.timeout(...) rejects with a TimeoutError; manual aborts use AbortError.
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";

    const msg = error.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("rate-limit")) {
      return "rate_limit";
    }
    if (
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("service unavailable") ||
      msg.includes("overloaded")
    ) {
      return "server_error";
    }
    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) {
      return "timeout";
    }
    if (msg.includes("econnreset") || msg.includes("socket hang up") || msg.includes("fetch failed")) {
      return "network";
    }
  }

  return null;
}

/** True when an error should trigger a fallback attempt on another model. */
export function isRetriableProviderError(error: unknown): boolean {
  return retriableReason(error) !== null;
}

/** Emitted once per fallback attempt so the composition root can count it as a metric. */
export interface AIFallbackEvent {
  fromModel: string;
  toModel: string;
  reason: FallbackReason;
}

/** Observer for fallback attempts — injected by the composition root (DI, like the metric sink). */
export type AIFallbackObserver = (event: AIFallbackEvent) => void;

let observer: AIFallbackObserver | null = null;

/** Injects the fallback observer. Pass `null` to reset (e.g. between tests). */
export function setAIFallbackObserver(next: AIFallbackObserver | null): void {
  observer = next;
}

function notifyFallback(event: AIFallbackEvent): void {
  if (!observer) return;
  try {
    observer(event);
  } catch {
    // A metric sink must never break the request path.
  }
}

/** Fixed budget split + the two models involved in a failover run. */
export interface ModelFailoverConfig {
  primaryModel: string;
  fallbackModel: string;
  primaryBudgetMs: number;
  reservedFallbackMs: number;
}

/** Runs one underlying generate call with a given model and abort budget. */
export type FailoverCall<R> = (model: string, opts: { budgetMs: number }) => Promise<R>;

/**
 * Runs `call` on the primary model bounded by `primaryBudgetMs`; on a retriable
 * failure it runs `call` on the fallback model bounded by `reservedFallbackMs` and
 * emits an {@link AIFallbackEvent}. A non-retriable failure is rethrown untouched
 * (no fallback) so real bugs are never masked.
 *
 * N2 dedup: when `primaryModel === fallbackModel` (e.g. the DB default is null so
 * both resolve to the hardcoded fallback), the primary runs exactly once and no
 * fallback attempt or metric is produced — a second identical attempt would be
 * pointless double-spend.
 */
export async function withModelFailover<R>(config: ModelFailoverConfig, call: FailoverCall<R>): Promise<R> {
  const { primaryModel, fallbackModel, primaryBudgetMs, reservedFallbackMs } = config;

  if (primaryModel === fallbackModel) {
    return call(primaryModel, { budgetMs: primaryBudgetMs });
  }

  try {
    return await call(primaryModel, { budgetMs: primaryBudgetMs });
  } catch (error) {
    const reason = retriableReason(error);
    if (reason === null) {
      throw error;
    }
    notifyFallback({ fromModel: primaryModel, toModel: fallbackModel, reason });
    return call(fallbackModel, { budgetMs: reservedFallbackMs });
  }
}
