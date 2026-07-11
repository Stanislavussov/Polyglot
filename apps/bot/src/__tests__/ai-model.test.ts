/**
 * Unit spec for the failover-split builder.
 *
 * Behaviour under test: `buildAiFailover(B)` carves a resolved request budget `B`
 * into a primary and a fallback window with a *scaled* reservation, so that a low
 * admin-configured timeout can neither silently disable failover nor starve the
 * primary below the fallback. Invariants for any returned split:
 *   - primaryBudgetMs + reservedFallbackMs <= B
 *   - primaryBudgetMs >= reservedFallbackMs  (primary keeps the larger share)
 *   - reservedFallbackMs <= RESERVED_FALLBACK_MS (never exceeds the ideal cap)
 * Below MIN_FAILOVER_BUDGET_MS the split is deliberately disabled (undefined).
 */
import { describe, expect, it } from "vitest";
import { buildAiFailover, FALLBACK_AI_MODEL, MIN_FAILOVER_BUDGET_MS, RESERVED_FALLBACK_MS } from "../utils/ai-model.js";

describe("buildAiFailover", () => {
  it("gives the full 5s reservation and the remainder to the primary at the default budget", () => {
    const split = buildAiFailover(15_000);
    expect(split).toEqual({
      fallbackModel: FALLBACK_AI_MODEL,
      primaryBudgetMs: 10_000,
      reservedFallbackMs: 5_000,
    });
  });

  it("scales the reservation down to ~1/3 of a mid-range budget so the primary keeps the larger share", () => {
    const split = buildAiFailover(9_000);
    expect(split).toEqual({
      fallbackModel: FALLBACK_AI_MODEL,
      primaryBudgetMs: 6_000,
      reservedFallbackMs: 3_000,
    });
  });

  it("disables the split (undefined) for a budget below the floor", () => {
    expect(buildAiFailover(4_000)).toBeUndefined();
  });

  it("disables the split exactly one ms below the floor and enables it at the floor", () => {
    expect(buildAiFailover(MIN_FAILOVER_BUDGET_MS - 1)).toBeUndefined();
    expect(buildAiFailover(MIN_FAILOVER_BUDGET_MS)).toBeDefined();
  });

  it("holds both budget invariants across the full admin-allowed range", () => {
    // Admin panel allows requestTimeoutMs in [1000, 20000].
    for (let budgetMs = 1_000; budgetMs <= 20_000; budgetMs += 250) {
      const split = buildAiFailover(budgetMs);
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
});
