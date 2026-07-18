/**
 * Pure per-model circuit breaker (bot self-healing Phase 3).
 *
 * Gates the AI failover path so a provider that is already failing is not hammered
 * with more doomed requests. It is DEFAULT-CLOSED and behavior-neutral: a freshly
 * created breaker's {@link CircuitBreaker.canProceed} returns `true`, and nothing
 * about request behavior changes until `failureThreshold` consecutive retriable
 * failures trip it open.
 *
 * State machine: `closed` → (threshold failures) → `open` → (cooldown elapsed) →
 * `half-open` → (probe success) → `closed`, or (probe failure) → `open` (cooldown
 * resets). Consecutive-failure counting is used (not a sliding window) — it is
 * simpler to reason about and sufficient for this failover-gate use.
 *
 * The clock is injectable (`now`) so tests are deterministic without fake timers,
 * and this module is dependency-free and metric-free: state transitions are
 * surfaced via an optional {@link CircuitBreakerConfig.onTransition} callback so a
 * composition root can drive a metric without this pure module importing one.
 */

/** The three circuit states. */
export type CircuitState = "closed" | "open" | "half-open";

/** Construction config for a {@link CircuitBreaker}. */
export interface CircuitBreakerConfig {
  /** Consecutive retriable failures that trip a closed breaker open. */
  failureThreshold: number;
  /** How long (ms) an open breaker stays open before allowing a half-open probe. */
  cooldownMs: number;
  /** How many trial calls a half-open breaker admits before deciding. */
  halfOpenProbes: number;
  /** Injectable clock for deterministic tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Fired on every state change (never on a no-op record). Drives metrics. */
  onTransition?: (to: CircuitState) => void;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly halfOpenProbes: number;
  private readonly now: () => number;
  private readonly onTransition?: (to: CircuitState) => void;

  private _state: CircuitState = "closed";
  /** Consecutive failures accumulated while closed. */
  private failures = 0;
  /** Timestamp (ms) the breaker last opened — start of the cooldown window. */
  private openedAt = 0;
  /** Probes admitted since entering half-open, capped at {@link halfOpenProbes}. */
  private probesGranted = 0;

  constructor(config: CircuitBreakerConfig) {
    this.failureThreshold = config.failureThreshold;
    this.cooldownMs = config.cooldownMs;
    this.halfOpenProbes = config.halfOpenProbes;
    this.now = config.now ?? Date.now;
    this.onTransition = config.onTransition;
  }

  /** Current state. */
  get state(): CircuitState {
    return this._state;
  }

  /**
   * True when a call may proceed: always while closed; while open only after the
   * cooldown has elapsed (which transitions to half-open and admits a probe); while
   * half-open until `halfOpenProbes` trial calls have been admitted.
   */
  canProceed(): boolean {
    if (this._state === "closed") return true;

    if (this._state === "open") {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.toHalfOpen();
        return true;
      }
      return false;
    }

    // half-open: admit up to halfOpenProbes trial calls, then hold until a result.
    if (this.probesGranted < this.halfOpenProbes) {
      this.probesGranted += 1;
      return true;
    }
    return false;
  }

  /** Records a successful call: a half-open probe closes the breaker; a closed breaker resets its failure count. */
  recordSuccess(): void {
    if (this._state === "closed") {
      this.failures = 0;
      return;
    }
    this.close();
  }

  /**
   * Records a retriable failure: in closed, `failureThreshold` consecutive failures
   * trip it open; in half-open, any failure re-opens it (cooldown resets); in open,
   * it simply refreshes the cooldown start.
   */
  recordFailure(): void {
    if (this._state === "open") {
      this.openedAt = this.now();
      return;
    }
    if (this._state === "half-open") {
      this.open();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.openedAt = this.now();
    this.failures = 0;
    this.probesGranted = 0;
    this.transitionTo("open");
  }

  private close(): void {
    this.failures = 0;
    this.probesGranted = 0;
    this.transitionTo("closed");
  }

  private toHalfOpen(): void {
    this.probesGranted = 1;
    this.transitionTo("half-open");
  }

  private transitionTo(next: CircuitState): void {
    if (this._state === next) return;
    this._state = next;
    this.onTransition?.(next);
  }
}
