/**
 * Unit spec for AI model resolution and the failover-split builder.
 *
 * Model ids come from the database only (`ai_models`: the `is_default` /
 * `is_fallback` flags an admin sets in the panel). There is no hardcoded model
 * constant to fall back on — the 2026-07-17 incident was a hardcoded fallback slug
 * OpenRouter rejects as "not a valid model ID", which no admin could fix without a
 * redeploy. So: no fallback row → no failover split; nothing configured at all →
 * AIModelNotConfiguredError.
 *
 * `buildAiFailover(B, fallbackModel)` carves a resolved request budget `B` into a
 * primary and a fallback window with a *scaled* reservation, so that a low
 * admin-configured timeout can neither silently disable failover nor starve the
 * primary. Invariants for any returned split:
 *   - primaryBudgetMs + reservedFallbackMs <= B
 *   - primaryBudgetMs >= reservedFallbackMs  (primary keeps the larger share)
 *   - reservedFallbackMs <= RESERVED_FALLBACK_MS (never exceeds the ideal cap)
 * Below MIN_FAILOVER_BUDGET_MS the split is deliberately disabled (undefined).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AIModelNotConfiguredError,
  buildAiFailover,
  MIN_FAILOVER_BUDGET_MS,
  RESERVED_FALLBACK_MS,
  resolveDefaultAIModel,
  resolveFallbackAIModel,
} from "../utils/ai-model.js";

const FALLBACK = "openai/gpt-5-nano";

describe("resolveFallbackAIModel", () => {
  it("returns the model an admin flagged in the database", async () => {
    const settings = { getFallbackAIModel: vi.fn().mockResolvedValue("openai/gpt-5-nano") };

    expect(await resolveFallbackAIModel(settings)).toBe("openai/gpt-5-nano");
  });

  it("returns null when no model is flagged, so the call runs without a split", async () => {
    const settings = { getFallbackAIModel: vi.fn().mockResolvedValue(null) };

    expect(await resolveFallbackAIModel(settings)).toBeNull();
  });

  it("returns null instead of inventing a model id when the settings read fails", async () => {
    // A DB blip must not take the primary call down with it, and it must not
    // resurrect a hardcoded slug either — failover is simply skipped this call.
    const settings = { getFallbackAIModel: vi.fn().mockRejectedValue(new Error("db down")) };

    expect(await resolveFallbackAIModel(settings)).toBeNull();
  });

  it("returns null when there is no settings port at all", async () => {
    expect(await resolveFallbackAIModel(undefined)).toBeNull();
  });
});

describe("resolveDefaultAIModel", () => {
  function settingsPort(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-4o"),
      getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-4o-plan"),
      getFallbackAIModel: vi.fn().mockResolvedValue(FALLBACK),
      ...overrides,
    };
  }

  it("prefers the plan's default model when a plan is given", async () => {
    expect(await resolveDefaultAIModel(settingsPort(), "plus")).toBe("openai/gpt-4o-plan");
  });

  it("uses the global default when no plan is given", async () => {
    expect(await resolveDefaultAIModel(settingsPort())).toBe("openai/gpt-4o");
  });

  it("falls back to the admin-set fallback model when no default is configured", async () => {
    const settings = settingsPort({
      getDefaultAIModel: vi.fn().mockResolvedValue(null),
      getDefaultAIModelForPlan: vi.fn().mockResolvedValue(null),
    });

    expect(await resolveDefaultAIModel(settings, "free")).toBe(FALLBACK);
  });

  it("throws when the database names no model at all, instead of guessing one", async () => {
    const settings = settingsPort({
      getDefaultAIModel: vi.fn().mockResolvedValue(null),
      getDefaultAIModelForPlan: vi.fn().mockResolvedValue(null),
      getFallbackAIModel: vi.fn().mockResolvedValue(null),
    });

    await expect(resolveDefaultAIModel(settings, "free")).rejects.toBeInstanceOf(AIModelNotConfiguredError);
  });

  it("throws when there is no settings port to read from", async () => {
    await expect(resolveDefaultAIModel(undefined)).rejects.toBeInstanceOf(AIModelNotConfiguredError);
  });
});

describe("buildAiFailover", () => {
  it("gives the full 5s reservation and the remainder to the primary at the default budget", () => {
    const split = buildAiFailover(15_000, FALLBACK);
    expect(split).toEqual({
      fallbackModel: FALLBACK,
      primaryBudgetMs: 10_000,
      reservedFallbackMs: 5_000,
    });
  });

  it("uses whichever model the admin configured, not a built-in one", () => {
    expect(buildAiFailover(15_000, "anthropic/claude-haiku-3.5")?.fallbackModel).toBe("anthropic/claude-haiku-3.5");
  });

  it("scales the reservation down to ~1/3 of a mid-range budget so the primary keeps the larger share", () => {
    const split = buildAiFailover(9_000, FALLBACK);
    expect(split).toEqual({
      fallbackModel: FALLBACK,
      primaryBudgetMs: 6_000,
      reservedFallbackMs: 3_000,
    });
  });

  it("disables the split when no fallback model is configured in the admin panel", () => {
    // Nothing to fail over TO — the call must run unsplit on the primary with the
    // whole budget rather than reserve a window for a model that does not exist.
    expect(buildAiFailover(15_000, null)).toBeUndefined();
  });

  it("disables the split (undefined) for a budget below the floor", () => {
    expect(buildAiFailover(4_000, FALLBACK)).toBeUndefined();
  });

  it("disables the split exactly one ms below the floor and enables it at the floor", () => {
    expect(buildAiFailover(MIN_FAILOVER_BUDGET_MS - 1, FALLBACK)).toBeUndefined();
    expect(buildAiFailover(MIN_FAILOVER_BUDGET_MS, FALLBACK)).toBeDefined();
  });

  it("holds both budget invariants across the full admin-allowed range", () => {
    // Admin panel allows requestTimeoutMs in [1000, 20000].
    for (let budgetMs = 1_000; budgetMs <= 20_000; budgetMs += 250) {
      const split = buildAiFailover(budgetMs, FALLBACK);
      if (split === undefined) {
        expect(budgetMs).toBeLessThan(MIN_FAILOVER_BUDGET_MS);
        continue;
      }
      expect(split.primaryBudgetMs + split.reservedFallbackMs).toBeLessThanOrEqual(budgetMs);
      expect(split.primaryBudgetMs).toBeGreaterThanOrEqual(split.reservedFallbackMs);
      expect(split.reservedFallbackMs).toBeLessThanOrEqual(RESERVED_FALLBACK_MS);
      expect(split.reservedFallbackMs).toBeGreaterThan(0);
    }
  });

  it("disables the split for a non-finite/non-positive budget instead of returning a NaN split", () => {
    // Regression for the "timed out after NaNms" outage: a partial ai.defaults blob
    // yielded requestTimeoutMs=undefined → NaN budget. `NaN < MIN` is false, so
    // without the isFinitePositive guard buildAiFailover returned {primaryBudgetMs:
    // NaN, reservedFallbackMs: NaN}, which setTimeout treats as an instant abort.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      expect(buildAiFailover(bad, FALLBACK)).toBeUndefined();
    }
  });
});
