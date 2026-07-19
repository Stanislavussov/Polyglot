/**
 * Spec for the per-model breaker registry (bot self-healing Phase 3).
 *
 * The registry lazily creates and caches one breaker per model id; model A's
 * health must never bleed into model B. It also fans circuit transitions out to an
 * injected observer tagged with the model id, so the composition root can drive a
 * per-model metric.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AICircuitEvent,
  BreakerRegistry,
  getBreaker,
  resetBreakerRegistry,
  setAICircuitObserver,
} from "../breaker-registry.js";

afterEach(() => {
  setAICircuitObserver(null);
  resetBreakerRegistry();
});

describe("BreakerRegistry", () => {
  it("returns the same breaker instance for the same model id (caches)", () => {
    const registry = new BreakerRegistry({ failureThreshold: 2, cooldownMs: 1_000, halfOpenProbes: 1 });
    expect(registry.getBreaker("model-a")).toBe(registry.getBreaker("model-a"));
  });

  it("isolates models: tripping model A's breaker does not affect model B", () => {
    const registry = new BreakerRegistry({ failureThreshold: 2, cooldownMs: 1_000, halfOpenProbes: 1 });
    const a = registry.getBreaker("model-a");
    const b = registry.getBreaker("model-b");

    a.recordFailure();
    a.recordFailure(); // A opens

    expect(a.state).toBe("open");
    expect(b.state).toBe("closed");
    expect(b.canProceed()).toBe(true);
  });

  it("reset() clears cached breakers so state does not leak between tests", () => {
    const registry = new BreakerRegistry({ failureThreshold: 1, cooldownMs: 1_000, halfOpenProbes: 1 });
    registry.getBreaker("model-a").recordFailure(); // opens
    expect(registry.getBreaker("model-a").state).toBe("open");

    registry.reset();
    expect(registry.getBreaker("model-a").state).toBe("closed"); // freshly created
  });

  it("fans transitions out to the injected observer tagged with the model id", () => {
    const events: AICircuitEvent[] = [];
    const registry = new BreakerRegistry({
      failureThreshold: 1,
      cooldownMs: 1_000,
      halfOpenProbes: 1,
      onEvent: (e) => events.push(e),
    });
    registry.getBreaker("model-x").recordFailure(); // closed → open

    expect(events).toEqual([{ model: "model-x", state: "open" }]);
  });
});

describe("default module registry", () => {
  it("getBreaker caches per model id in the process-wide default registry", () => {
    expect(getBreaker("shared-model")).toBe(getBreaker("shared-model"));
  });

  it("routes default-registry transitions through the injected circuit observer", () => {
    const observer = vi.fn();
    setAICircuitObserver(observer);

    // Default threshold is 5 consecutive failures.
    const breaker = getBreaker("default-model");
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    expect(breaker.state).toBe("open");
    expect(observer).toHaveBeenCalledWith({ model: "default-model", state: "open" });
  });

  it("a thrown observer never propagates out of a transition (metric sink is best-effort)", () => {
    setAICircuitObserver(() => {
      throw new Error("metric sink blew up");
    });
    const breaker = getBreaker("resilient-model");
    for (let i = 0; i < 5; i++) {
      expect(() => breaker.recordFailure()).not.toThrow();
    }
    expect(breaker.state).toBe("open");
  });
});
