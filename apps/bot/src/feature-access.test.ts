import type { PlanLimitConfig } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { createFeatureAccess } from "./feature-access.js";

const PLAN_CONFIGS: Record<string, PlanLimitConfig> = {
  free: {
    name: "free",
    label: "Free",
    translationLimit: 20,
    creditCost: 1,
    videoLimit: 3,
    videoWindow: "lifetime",
    isActive: true,
    isDefault: true,
  },
  plus: {
    name: "plus",
    label: "Plus",
    translationLimit: null,
    creditCost: 1,
    videoLimit: 10,
    videoWindow: "monthly",
    isActive: true,
    isDefault: false,
  },
};

const PLAN_FEATURES: Record<string, string[]> = {
  free: [],
  plus: ["grammarBreakdown", "etymology", "grammarDetail"],
};

function makeAccess() {
  return createFeatureAccess({
    settings: { getPlanLimit: async (plan) => PLAN_CONFIGS[plan] ?? null },
    planFeatureAccess: { findFeaturesForPlan: async (plan) => PLAN_FEATURES[plan] ?? [] },
  });
}

describe("createFeatureAccess", () => {
  it("denies premium features to free (product) users", async () => {
    const access = makeAccess();
    const result = await access.checkFeatureAccess({ audienceGroup: "product", subscriptionPlan: "free" }, "etymology");
    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe("requires_upgrade");
  });

  it("grants premium features to plus (product) users", async () => {
    const access = makeAccess();
    const result = await access.checkFeatureAccess({ audienceGroup: "product", subscriptionPlan: "plus" }, "etymology");
    expect(result.hasAccess).toBe(true);
  });

  it.each(["admin", "tester"] as const)("grants premium features to %s regardless of plan", async (audienceGroup) => {
    const access = makeAccess();
    const result = await access.checkFeatureAccess({ audienceGroup, subscriptionPlan: "free" }, "grammarDetail");
    expect(result.hasAccess).toBe(true);
  });
});
