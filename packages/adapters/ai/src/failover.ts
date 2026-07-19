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

import { AICircuitOpenError, AITimeoutError, getBreaker } from "@polyglot/core";

/** HTTP statuses worth retrying on a *different* model: rate limits, gateway/upstream failures, timeouts. */
const RETRIABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Coarse, bounded reason label for the `bot_ai_fallback_total` metric. Kept to a
 * fixed small set so the metric never explodes in cardinality. `circuit_open` is
 * the routing reason when the primary's breaker was open and its attempt was
 * skipped entirely (Phase 3) rather than failed by the provider.
 */
export type FallbackReason = "timeout" | "rate_limit" | "server_error" | "network" | "circuit_open";

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
 * Kill-switch for the Phase 3 circuit-breaker gate. Default ON. When OFF,
 * {@link withModelFailover} behaves EXACTLY as Phase 2 (no breaker gate, no
 * records) — the plan's redeploy-free rollback path. Wired from the
 * `AI_CIRCUIT_BREAKER_ENABLED` env var by the composition root.
 */
let circuitBreakerEnabled = true;

/** Enables/disables the circuit-breaker gate. Injected by the composition root. */
export function setAICircuitBreakerEnabled(enabled: boolean): void {
  circuitBreakerEnabled = enabled;
}

/**
 * Phase 2 failover (no circuit breaker). Runs `call` on the primary model bounded
 * by `primaryBudgetMs`; on a retriable failure it runs `call` on the fallback model
 * bounded by `reservedFallbackMs` and emits an {@link AIFallbackEvent}. A
 * non-retriable failure is rethrown untouched (no fallback) so real bugs are never
 * masked.
 *
 * N2 dedup: when `primaryModel === fallbackModel` (e.g. the DB default is null so
 * both resolve to the hardcoded fallback), the primary runs exactly once and no
 * fallback attempt or metric is produced — a second identical attempt would be
 * pointless double-spend.
 */
async function withModelFailoverUngated<R>(config: ModelFailoverConfig, call: FailoverCall<R>): Promise<R> {
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

/**
 * Phase 3 failover WITH the per-model circuit breaker gate. Semantics:
 *
 * 1. If the primary breaker allows it, attempt the primary (bounded by
 *    `primaryBudgetMs`). Success → `recordSuccess`, return. Retriable failure →
 *    `recordFailure`, fall through to the fallback step. Non-retriable failure →
 *    rethrow WITHOUT recording (a 4xx/validation bug is not a provider-health
 *    signal and must never trip the breaker or be masked) — UNLESS the breaker was
 *    half-open, in which case the non-retriable error is still proof the provider
 *    responded, so it is recorded as a success (closing the breaker) before the
 *    rethrow (see the half-open note below).
 * 2. Fallback step (primary skipped-because-open OR failed retriably):
 *    - Dedup (`primaryModel === fallbackModel`): a second identical call is
 *      pointless. If the primary was attempted and failed retriably, rethrow that
 *      error; if it was skipped because its (shared) breaker is open, throw
 *      {@link AICircuitOpenError}.
 *    - Else if the fallback breaker allows it, attempt the fallback (bounded by
 *      `reservedFallbackMs`). Success → `recordSuccess`, notify, return. Retriable
 *      failure → `recordFailure`, rethrow. Non-retriable → rethrow (no record),
 *      same half-open proof-of-life exception as the primary leg.
 *    - Else (fallback breaker also open) → throw {@link AICircuitOpenError} with NO
 *      provider call — the whole point is to stop hammering a down provider.
 *
 * Half-open proof-of-life: a half-open breaker admits exactly one probe and does
 * not re-arm on its own (no cooldown while half-open), so a probe response that
 * gets a non-retriable error (e.g. a 4xx / validation failure) would otherwise
 * wedge the breaker half-open FOREVER — the provider clearly responded (it is
 * alive), but "no record on non-retriable" would never close it. Recording that as
 * a success (closing the breaker) before rethrowing is semantically correct: a
 * non-retriable response proves connectivity, which is exactly what a half-open
 * probe is trying to establish. This does NOT change closed-state behavior (a
 * non-retriable error while closed still records nothing).
 *
 * Default-closed and behavior-neutral: with both breakers closed (the steady
 * state) this makes the same calls, in the same order, with the same budgets as
 * {@link withModelFailoverUngated} — the breaker only changes behavior once a
 * provider has actually been failing.
 */
async function withModelFailoverGated<R>(config: ModelFailoverConfig, call: FailoverCall<R>): Promise<R> {
  const { primaryModel, fallbackModel, primaryBudgetMs, reservedFallbackMs } = config;
  const primaryBreaker = getBreaker(primaryModel);
  const dedup = primaryModel === fallbackModel;

  let primaryError: unknown;
  let primaryReason: FallbackReason | null = null;
  let primaryAttempted = false;

  if (primaryBreaker.canProceed()) {
    primaryAttempted = true;
    try {
      const result = await call(primaryModel, { budgetMs: primaryBudgetMs });
      primaryBreaker.recordSuccess();
      return result;
    } catch (error) {
      const reason = retriableReason(error);
      if (reason === null) {
        // Non-retriable: not a provider-health signal — never trip the breaker.
        // EXCEPT a half-open probe: a non-retriable response still proves the
        // provider is alive, so record it as a success (closes the breaker)
        // before rethrowing — otherwise a half-open breaker with a non-retriable
        // probe result would wedge open forever (no cooldown while half-open).
        if (primaryBreaker.state === "half-open") {
          primaryBreaker.recordSuccess();
        }
        throw error;
      }
      primaryBreaker.recordFailure();
      primaryError = error;
      primaryReason = reason;
    }
  }

  // ── Fallback step ──────────────────────────────────────────────────
  if (dedup) {
    // Same model = same breaker: a second call would be pointless double-spend.
    if (primaryAttempted) throw primaryError;
    throw new AICircuitOpenError(primaryModel);
  }

  const fallbackBreaker = getBreaker(fallbackModel);
  if (!fallbackBreaker.canProceed()) {
    // Fallback breaker also open: fast-fail with NO provider call.
    throw new AICircuitOpenError(fallbackModel);
  }

  try {
    const result = await call(fallbackModel, { budgetMs: reservedFallbackMs });
    fallbackBreaker.recordSuccess();
    notifyFallback({ fromModel: primaryModel, toModel: fallbackModel, reason: primaryReason ?? "circuit_open" });
    return result;
  } catch (error) {
    if (retriableReason(error) !== null) {
      fallbackBreaker.recordFailure();
    } else if (fallbackBreaker.state === "half-open") {
      // Same half-open proof-of-life exception as the primary leg: a non-retriable
      // response still proves the fallback provider is alive.
      fallbackBreaker.recordSuccess();
    }
    throw error;
  }
}

/**
 * Routes an AI generate call through fallback-model failover, gated per model by a
 * circuit breaker when {@link setAICircuitBreakerEnabled} is on (default). With the
 * kill-switch off it is exactly the Phase 2 behavior — see
 * {@link withModelFailoverGated} and {@link withModelFailoverUngated} for the two
 * paths.
 */
export async function withModelFailover<R>(config: ModelFailoverConfig, call: FailoverCall<R>): Promise<R> {
  return circuitBreakerEnabled ? withModelFailoverGated(config, call) : withModelFailoverUngated(config, call);
}
