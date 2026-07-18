/**
 * Per-model circuit breaker registry (bot self-healing Phase 3).
 *
 * Lazily creates and caches one {@link CircuitBreaker} per model id so model A's
 * health can never affect model B. The default module registry is a singleton the
 * failover path reads through; a {@link BreakerRegistry} can also be constructed
 * directly with custom config + clock for deterministic tests.
 *
 * Circuit state transitions are surfaced through an injectable observer
 * ({@link setAICircuitObserver}) — parallel to the AI-fallback observer — so the
 * composition root drives a metric from a transition without this pure module
 * importing one.
 */

import { CircuitBreaker, type CircuitState } from "./circuit-breaker.js";

/** A circuit state transition for a specific model. */
export interface AICircuitEvent {
  model: string;
  state: CircuitState;
}

/** Observer for circuit transitions — injected by the composition root (DI, like the fallback sink). */
export type AICircuitObserver = (event: AICircuitEvent) => void;

/** Sensible production defaults: 5 consecutive failures, 30s cooldown, 1 half-open probe. */
export const DEFAULT_BREAKER_FAILURE_THRESHOLD = 5;
export const DEFAULT_BREAKER_COOLDOWN_MS = 30_000;
export const DEFAULT_BREAKER_HALF_OPEN_PROBES = 1;

/** Optional overrides for a {@link BreakerRegistry} (all fields default to the module defaults). */
export interface BreakerRegistryOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  halfOpenProbes?: number;
  now?: () => number;
  onEvent?: AICircuitObserver;
}

/** A cache of per-model breakers sharing one config + clock. */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly options: BreakerRegistryOptions = {}) {}

  getBreaker(modelId: string): CircuitBreaker {
    const existing = this.breakers.get(modelId);
    if (existing) return existing;

    const breaker = new CircuitBreaker({
      failureThreshold: this.options.failureThreshold ?? DEFAULT_BREAKER_FAILURE_THRESHOLD,
      cooldownMs: this.options.cooldownMs ?? DEFAULT_BREAKER_COOLDOWN_MS,
      halfOpenProbes: this.options.halfOpenProbes ?? DEFAULT_BREAKER_HALF_OPEN_PROBES,
      now: this.options.now,
      onTransition: (state) => this.options.onEvent?.({ model: modelId, state }),
    });
    this.breakers.set(modelId, breaker);
    return breaker;
  }

  reset(): void {
    this.breakers.clear();
  }
}

let circuitObserver: AICircuitObserver | null = null;

/** Injects the circuit observer. Pass `null` to reset (e.g. between tests). */
export function setAICircuitObserver(next: AICircuitObserver | null): void {
  circuitObserver = next;
}

function notifyCircuit(event: AICircuitEvent): void {
  if (!circuitObserver) return;
  try {
    circuitObserver(event);
  } catch {
    // A metric sink must never break the request path.
  }
}

/** The process-wide default registry the failover path reads through. */
const defaultRegistry = new BreakerRegistry({ onEvent: notifyCircuit });

/** Returns the cached breaker for `modelId` from the default registry, creating it on first use. */
export function getBreaker(modelId: string): CircuitBreaker {
  return defaultRegistry.getBreaker(modelId);
}

/** Clears every cached breaker in the default registry (test isolation / manual reset). */
export function resetBreakerRegistry(): void {
  defaultRegistry.reset();
}
