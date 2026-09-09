import type { PlanLimitConfig } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { createFeatureAccess } from "./feature-access.js";

const PLAN_CONFIGS: Record<string, PlanLimitConfig> = {
  free: {
    name: "free",
    label: "Free",
    translationLimit: 10,
    creditCost: 1,
    videoLimit: 0,
    videoWindow: "none",
    mentorDailyLimit: null,
    priceUsdCents: null,
    isActive: true,
    isDefault: true,
  },
  plus: {
    name: "plus",
    label: "Plus",
    translationLimit: null,
    creditCost: 1,
    videoLimit: 20,
    videoWindow: "monthly",
    mentorDailyLimit: null,
    priceUsdCents: 500,
    isActive: true,
    isDefault: false,
  },
  pro: {
    name: "pro",
    label: "Pro",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "monthly",
    mentorDailyLimit: null,
    priceUsdCents: 1000,
    isActive: true,
    isDefault: false,
  },
};

const PLAN_FEATURES: Record<string, string[]> = {
  free: [],
  plus: ["grammarBreakdown", "etymology", "grammarDetail", "clarification"],
  pro: ["grammarBreakdown", "etymology", "grammarDetail", "clarification", "pronunciation"],
};

function makeAccess() {
  const getPlanLimit = vi.fn(async (plan: string) => PLAN_CONFIGS[plan] ?? null);
  const findFeaturesForPlan = vi.fn(async (plan: string) => PLAN_FEATURES[plan] ?? []);
  const access = createFeatureAccess({ settings: { getPlanLimit }, planFeatureAccess: { findFeaturesForPlan } });
  return { access, getPlanLimit, findFeaturesForPlan };
}

describe("createFeatureAccess", () => {
  it("denies premium features to free (product) users", async () => {
    const { access } = makeAccess();
    const result = await access.checkFeatureAccess({ audienceGroup: "product", subscriptionPlan: "free" }, "etymology");
    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe("requires_upgrade");
  });

  it("grants premium features to plus (product) users", async () => {
    const { access } = makeAccess();
    const result = await access.checkFeatureAccess({ audienceGroup: "product", subscriptionPlan: "plus" }, "etymology");
    expect(result.hasAccess).toBe(true);
  });

  it.each(["admin", "tester"] as const)("grants premium features to %s regardless of plan", async (audienceGroup) => {
    const { access } = makeAccess();
    const result = await access.checkFeatureAccess({ audienceGroup, subscriptionPlan: "free" }, "grammarDetail");
    expect(result.hasAccess).toBe(true);
  });

  it("keeps word audio out of Plus and inside Pro", async () => {
    const { access } = makeAccess();
    const plus = await access.checkFeatureAccess(
      { audienceGroup: "product", subscriptionPlan: "plus" },
      "pronunciation",
    );
    const pro = await access.checkFeatureAccess({ audienceGroup: "product", subscriptionPlan: "pro" }, "pronunciation");
    expect(plus.hasAccess).toBe(false);
    expect(pro.hasAccess).toBe(true);
  });

  it("resolves the whole feature set in one plan lookup, so a card can mark every button at once", async () => {
    const { access, getPlanLimit, findFeaturesForPlan } = makeAccess();

    const features = await access.listFeatures({ audienceGroup: "product", subscriptionPlan: "plus" });

    expect([...features].sort()).toEqual([...PLAN_FEATURES.plus!].sort());
    expect(getPlanLimit).toHaveBeenCalledTimes(1);
    expect(findFeaturesForPlan).toHaveBeenCalledTimes(1);
  });
});
