/**
 * Drift guards between the three places that describe plans and features:
 * the core entitlements module, the admin contracts, and the seed catalog.
 * Each pair cannot import the other at runtime (browser bundle vs server
 * core), so these tests are the lockstep.
 */
import { featureKeySchema, rateLimitPlanSchema } from "@polyglot/admin-contracts";
import { ALL_FEATURES, FREE_FALLBACK } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_CATALOG } from "./plan-catalog.js";

describe("plan catalog drift guards", () => {
  it("contracts featureKeySchema lists exactly the feature keys the bot gates on", () => {
    // A key present in core but missing here would be impossible to grant from
    // the admin panel; a key present here but not in core would grant nothing.
    expect([...featureKeySchema.options].sort()).toEqual([...ALL_FEATURES].sort());
  });

  it("core FREE_FALLBACK mirrors the bootstrapped free plan", () => {
    const free = DEFAULT_PLAN_CATALOG.find((plan) => plan.name === "free");
    expect(free).toBeDefined();
    // A missing plan config resolves to FREE_FALLBACK — if the seeded free plan
    // diverges, users on a half-configured DB silently get different limits.
    expect(FREE_FALLBACK).toEqual({
      translationLimit: free?.translationLimit,
      videoLimit: free?.videoLimit,
      videoWindow: free?.videoWindow,
    });
  });

  it("every catalog entry passes the same contract the admin panel submits with", () => {
    for (const entry of DEFAULT_PLAN_CATALOG) {
      const parsed = rateLimitPlanSchema.safeParse({ ...entry, aiModelId: null });
      expect(parsed.success, `catalog entry ${entry.name} violates rateLimitPlanSchema`).toBe(true);
    }
  });

  it("exactly one catalog plan is the default landing plan for new users", () => {
    expect(DEFAULT_PLAN_CATALOG.filter((plan) => plan.isDefault).map((plan) => plan.name)).toEqual(["free"]);
  });
});
