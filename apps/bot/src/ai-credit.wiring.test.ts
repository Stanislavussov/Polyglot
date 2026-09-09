/**
 * Spec for the OpenRouter credit exporter (Task 78). Assertions read the real
 * registry rather than spying on `.set()`, because "the series is absent" is
 * the actual contract with Prometheus and a spy cannot observe it.
 */

import { register } from "prom-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchLike, refreshAiCredit } from "./ai-credit.wiring.js";

vi.mock("@polyglot/core", () => ({
  logEvent: vi.fn(),
  errorFields: (err: unknown) => ({ err: String(err) }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// metrics.ts pulls in the DB adapter for /readyz; stubbed, not connected.
vi.mock("@polyglot/adapter-db", () => ({
  pingDatabase: vi.fn(async () => true),
}));

/** Current sample of a no-label gauge, or null when the series is withdrawn. */
async function gaugeValue(name: string): Promise<number | null> {
  const metric = register.getSingleMetric(name);
  if (!metric) return null;
  const snapshot = (await metric.get()) as { values: Array<{ value: number }> };
  return snapshot.values.length === 0 ? null : (snapshot.values[0]?.value ?? null);
}

function respondWith(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Payment Required",
    json: async () => body,
  }));
}

describe("refreshAiCredit", () => {
  beforeEach(() => {
    register.getSingleMetric("bot_ai_credit_usage_usd")?.reset();
    register.getSingleMetric("bot_ai_credit_limit_usd")?.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes usage and limit for a key with a spend cap", async () => {
    const result = await refreshAiCredit("key", respondWith({ data: { usage: 0.25, limit: 1 } }));

    expect(result).toEqual({ usage: 0.25, limit: 1 });
    expect(await gaugeValue("bot_ai_credit_usage_usd")).toBe(0.25);
    expect(await gaugeValue("bot_ai_credit_limit_usd")).toBe(1);
  });

  it("publishes a near-limit reading that crosses the alert's 0.9 ratio", async () => {
    // The 2026-08-22 outage one step before it happened.
    await refreshAiCredit("key", respondWith({ data: { usage: 0.95, limit: 1 } }));

    const usage = await gaugeValue("bot_ai_credit_usage_usd");
    const limit = await gaugeValue("bot_ai_credit_limit_usd");
    expect(usage).not.toBeNull();
    expect(limit).not.toBeNull();
    expect((usage as number) / (limit as number)).toBeGreaterThan(0.9);
  });

  it("leaves both series absent for a key with no spend limit", async () => {
    // Not zero, not Infinity — absent. A limit of 0 divides by zero and +Inf
    // poisons sum().
    const result = await refreshAiCredit("key", respondWith({ data: { usage: 12.5, limit: null } }));

    expect(result).toEqual({ usage: 12.5, limit: null });
    expect(await gaugeValue("bot_ai_credit_usage_usd")).toBeNull();
    expect(await gaugeValue("bot_ai_credit_limit_usd")).toBeNull();
  });

  it("returns null and preserves the previous reading when the provider call fails", async () => {
    await refreshAiCredit("key", respondWith({ data: { usage: 0.95, limit: 1 } }));

    const result = await refreshAiCredit("key", respondWith({ error: "nope" }, false, 402));

    // The stale reading must survive: clearing it would resolve the alert at
    // exactly the moment it should fire.
    expect(result).toBeNull();
    expect(await gaugeValue("bot_ai_credit_usage_usd")).toBe(0.95);
  });

  it("returns null and does not throw when the provider response is malformed", async () => {
    const result = await refreshAiCredit("key", respondWith({ data: { usage: "lots" } }));

    expect(result).toBeNull();
  });

  it("returns null and does not throw when the network rejects", async () => {
    const exploding: FetchLike = vi.fn(async () => {
      throw new Error("ETIMEDOUT");
    });

    await expect(refreshAiCredit("key", exploding)).resolves.toBeNull();
  });

  it("sends the API key as a bearer token", async () => {
    const fetchImpl = respondWith({ data: { usage: 0, limit: 5 } });

    await refreshAiCredit("sk-test-123", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({ headers: { Authorization: "Bearer sk-test-123" } }),
    );
  });
});
