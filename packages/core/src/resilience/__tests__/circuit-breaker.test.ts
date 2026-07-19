/**
 * Spec for the pure per-model {@link CircuitBreaker} (bot self-healing Phase 3).
 *
 * The breaker gates the AI failover path. It must be DEFAULT-CLOSED and
 * behavior-neutral until `failureThreshold` consecutive retriable failures trip it
 * open, then follow closed → open → half-open → (closed | open) with a cooldown.
 * The clock is injected so timing is deterministic without fake timers.
 */
import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, type CircuitState } from "../circuit-breaker.js";

/** A hand-cranked clock so cooldown transitions are exact and deterministic. */
function makeClock(start = 0) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

describe("CircuitBreaker", () => {
  it("starts closed and lets calls proceed with zero behavior change", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000, halfOpenProbes: 1 });
    expect(breaker.state).toBe("closed");
    expect(breaker.canProceed()).toBe(true);
    // A success on a closed breaker keeps it closed and proceeding.
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    expect(breaker.canProceed()).toBe(true);
  });

  it("opens after N consecutive failures and then refuses calls while cooling", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000, halfOpenProbes: 1, now: clock.now });

    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed"); // below threshold
    expect(breaker.canProceed()).toBe(true);

    breaker.recordFailure(); // 3rd consecutive → open
    expect(breaker.state).toBe("open");
    expect(breaker.canProceed()).toBe(false); // cooling: refuse
  });

  it("a success resets the consecutive-failure count so the threshold is truly consecutive", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000, halfOpenProbes: 1 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess(); // resets the streak
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed"); // only 2 consecutive since the reset
  });

  it("transitions to half-open after the cooldown elapses and admits exactly one probe", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000, halfOpenProbes: 1, now: clock.now });

    breaker.recordFailure(); // → open at t=0
    expect(breaker.canProceed()).toBe(false);

    clock.advance(999);
    expect(breaker.canProceed()).toBe(false); // still cooling (< cooldownMs)

    clock.advance(1); // now exactly cooldownMs elapsed
    expect(breaker.canProceed()).toBe(true); // admits the probe → half-open
    expect(breaker.state).toBe("half-open");
    expect(breaker.canProceed()).toBe(false); // only one probe admitted
  });

  it("closes on a successful half-open probe (recovery)", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000, halfOpenProbes: 1, now: clock.now });
    breaker.recordFailure();
    clock.advance(1_000);
    expect(breaker.canProceed()).toBe(true); // → half-open

    breaker.recordSuccess(); // probe succeeded → closed
    expect(breaker.state).toBe("closed");
    expect(breaker.canProceed()).toBe(true);
  });

  it("re-opens on a failed half-open probe AND resets the cooldown window", () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000, halfOpenProbes: 1, now: clock.now });
    breaker.recordFailure(); // open at t=0
    clock.advance(1_000);
    expect(breaker.canProceed()).toBe(true); // → half-open at t=1000

    breaker.recordFailure(); // probe failed → open, cooldown restarts at t=1000
    expect(breaker.state).toBe("open");

    clock.advance(999);
    expect(breaker.canProceed()).toBe(false); // cooldown reset from t=1000, not yet elapsed
    clock.advance(1);
    expect(breaker.canProceed()).toBe(true); // full fresh cooldown elapsed
  });

  it("emits every state transition through onTransition (drives the metric)", () => {
    const clock = makeClock();
    const transitions: CircuitState[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1_000,
      halfOpenProbes: 1,
      now: clock.now,
      onTransition: (to) => transitions.push(to),
    });

    breaker.recordFailure(); // closed → open
    clock.advance(1_000);
    breaker.canProceed(); // open → half-open
    breaker.recordSuccess(); // half-open → closed

    expect(transitions).toEqual(["open", "half-open", "closed"]);
  });

  it("does not fire onTransition on a no-op record (a success while already closed)", () => {
    const onTransition = vi.fn();
    const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1_000, halfOpenProbes: 1, onTransition });
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(onTransition).not.toHaveBeenCalled();
  });
});
