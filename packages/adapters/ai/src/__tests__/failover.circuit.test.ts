/**
 * Integration spec for the Phase 3 circuit-breaker gate over `withModelFailover`.
 *
 * The breaker sits on the SAME AI request path that a mis-tuned budget once took
 * down (the "timed out after NaNms" outage), so the two load-bearing guarantees
 * here are:
 *   1. HAPPY-PATH NEUTRALITY — with the breaker closed (the default, steady state)
 *      the gated path makes the exact same calls, in the same order, with the same
 *      budgets and results as the ungated Phase 2 path. Zero behavior change.
 *   2. KILL-SWITCH — with `setAICircuitBreakerEnabled(false)` the gate disappears
 *      entirely, even with a pre-opened breaker: the redeploy-free rollback path.
 *
 * Plus the routing semantics: an open primary routes to the fallback with NO
 * primary call; both open fast-fails with `AICircuitOpenError` and NO provider
 * call; a non-retriable error never trips the breaker.
 *
 * The registry is the process-wide default singleton shared with the adapter, so
 * breakers are tripped via the real `getBreaker` and reset between tests.
 */
import { AICircuitOpenError, getBreaker, resetBreakerRegistry } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAICircuitBreakerEnabled, setAIFallbackObserver, withModelFailover } from "../failover.js";

const config = {
  primaryModel: "primary/model",
  fallbackModel: "fallback/model",
  primaryBudgetMs: 10_000,
  reservedFallbackMs: 5_000,
};

/** Trips a model's breaker fully open — the default threshold is 5 consecutive failures. */
function tripOpen(model: string): void {
  const breaker = getBreaker(model);
  for (let i = 0; i < 5; i++) breaker.recordFailure();
  expect(breaker.state).toBe("open");
}

const observer = vi.fn();

beforeEach(() => {
  resetBreakerRegistry();
  setAICircuitBreakerEnabled(true);
  observer.mockClear();
  setAIFallbackObserver(observer);
});

afterEach(() => {
  setAIFallbackObserver(null);
  setAICircuitBreakerEnabled(true);
  resetBreakerRegistry();
});

describe("withModelFailover circuit gate — routing", () => {
  it("routes to the fallback WITHOUT calling the primary when the primary breaker is open", async () => {
    tripOpen(config.primaryModel);
    const call = vi.fn().mockResolvedValue("fallback-reply");

    const result = await withModelFailover(config, call);

    expect(result).toBe("fallback-reply");
    // The primary was skipped entirely — only the fallback was called.
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("fallback/model", { budgetMs: 5_000 });
    expect(observer).toHaveBeenCalledWith({
      fromModel: "primary/model",
      toModel: "fallback/model",
      reason: "circuit_open",
    });
  });

  it("fast-fails with AICircuitOpenError and makes NO provider call when both breakers are open", async () => {
    tripOpen(config.primaryModel);
    tripOpen(config.fallbackModel);
    const call = vi.fn();

    await expect(withModelFailover(config, call)).rejects.toBeInstanceOf(AICircuitOpenError);
    expect(call).not.toHaveBeenCalled();
  });

  it("throws AICircuitOpenError (not a wasted second call) when a same-model breaker is open", async () => {
    const dedup = { ...config, fallbackModel: config.primaryModel };
    tripOpen(dedup.primaryModel);
    const call = vi.fn();

    await expect(withModelFailover(dedup, call)).rejects.toBeInstanceOf(AICircuitOpenError);
    expect(call).not.toHaveBeenCalled();
  });

  it("a non-retriable primary error is rethrown and NEVER trips the breaker", async () => {
    const err = { statusCode: 400 };
    const call = vi.fn().mockRejectedValue(err);

    // Even after many 4xx failures the breaker must stay closed — a client/validation
    // bug is not a provider-health signal.
    for (let i = 0; i < 6; i++) {
      await expect(withModelFailover(config, call)).rejects.toBe(err);
    }

    expect(getBreaker("primary/model").state).toBe("closed");
    expect(observer).not.toHaveBeenCalled();
  });

  it("records a retriable primary failure on the breaker and still fails over", async () => {
    const call = vi.fn().mockRejectedValueOnce({ statusCode: 429 }).mockResolvedValueOnce("fallback-reply");

    const result = await withModelFailover(config, call);

    expect(result).toBe("fallback-reply");
    expect(call).toHaveBeenNthCalledWith(1, "primary/model", { budgetMs: 10_000 });
    expect(call).toHaveBeenNthCalledWith(2, "fallback/model", { budgetMs: 5_000 });
    expect(observer).toHaveBeenCalledWith({
      fromModel: "primary/model",
      toModel: "fallback/model",
      reason: "rate_limit",
    });
  });
});

describe("withModelFailover circuit gate — half-open recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a non-retriable error on the half-open probe still closes the breaker (proof of life) instead of wedging it open forever", async () => {
    vi.useFakeTimers();

    // 5 consecutive retriable failures → open (default failureThreshold).
    tripOpen(config.primaryModel);
    const breaker = getBreaker(config.primaryModel);

    // Advance past the default 30s cooldown so the next canProceed() call
    // transitions open → half-open and admits exactly one probe.
    vi.advanceTimersByTime(30_001);

    // The half-open probe gets a NON-retriable response (e.g. a 4xx) — this still
    // proves the provider is alive and responding, so the breaker must close, not
    // stay wedged half-open (no cooldown re-arms itself in half-open).
    const probeCall = vi.fn().mockRejectedValueOnce({ statusCode: 400 });
    await expect(withModelFailover(config, probeCall)).rejects.toEqual({ statusCode: 400 });
    expect(probeCall).toHaveBeenCalledTimes(1);

    // Not wedged: closed again, and canProceed() is true without needing another cooldown.
    expect(breaker.state).toBe("closed");
    expect(breaker.canProceed()).toBe(true);

    // A subsequent normal request goes through the gate and succeeds — the
    // provider is not sidelined until process restart.
    const recoveredCall = vi.fn().mockResolvedValue("recovered");
    await expect(withModelFailover(config, recoveredCall)).resolves.toBe("recovered");
    expect(recoveredCall).toHaveBeenCalledWith("primary/model", { budgetMs: 10_000 });
  });
});

describe("withModelFailover circuit gate — happy-path neutrality", () => {
  it("with the breaker closed, N successful calls behave identically to the ungated path", async () => {
    // Gated (default): five successful calls.
    const gatedCall = vi.fn(async (model: string) => `ok:${model}`);
    const gatedResults: string[] = [];
    for (let i = 0; i < 5; i++) gatedResults.push(await withModelFailover(config, gatedCall));

    // Ungated (kill-switch off): the exact same scenario.
    resetBreakerRegistry();
    setAICircuitBreakerEnabled(false);
    const ungatedCall = vi.fn(async (model: string) => `ok:${model}`);
    const ungatedResults: string[] = [];
    for (let i = 0; i < 5; i++) ungatedResults.push(await withModelFailover(config, ungatedCall));

    // Same results, same call count, same call arguments — zero behavior change.
    expect(gatedResults).toEqual(ungatedResults);
    expect(gatedResults).toEqual(Array(5).fill("ok:primary/model"));
    expect(gatedCall.mock.calls).toEqual(ungatedCall.mock.calls);
    expect(gatedCall).toHaveBeenCalledTimes(5);
    for (const args of gatedCall.mock.calls) {
      expect(args).toEqual(["primary/model", { budgetMs: 10_000 }]);
    }
    // A pure happy path never falls over and never touches the fallback metric.
    expect(observer).not.toHaveBeenCalled();
    expect(getBreaker("primary/model").state).toBe("closed");
  });
});

describe("withModelFailover circuit gate — kill-switch", () => {
  it("with the kill-switch off, an OPEN breaker is ignored and the primary is still called", async () => {
    tripOpen(config.primaryModel);
    setAICircuitBreakerEnabled(false);
    const call = vi.fn().mockResolvedValue("primary-reply");

    // Ungated path ignores the breaker entirely — the primary runs despite being "open".
    const result = await withModelFailover(config, call);

    expect(result).toBe("primary-reply");
    expect(call).toHaveBeenCalledWith("primary/model", { budgetMs: 10_000 });
  });
});
