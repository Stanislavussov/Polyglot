import { describe, expect, it } from "vitest";
import { ALL_FEATURES, FEATURE_KEYS, type PlanEntitlementConfig, resolveEntitlements } from "./index.js";

const FREE: PlanEntitlementConfig = { translationLimit: 20, videoLimit: 3, videoWindow: "lifetime" };
const PLUS: PlanEntitlementConfig = { translationLimit: null, videoLimit: 10, videoWindow: "monthly" };
const PRO: PlanEntitlementConfig = { translationLimit: null, videoLimit: null, videoWindow: "monthly" };
const PREMIUM_FEATURES = [FEATURE_KEYS.grammarBreakdown, FEATURE_KEYS.etymology, FEATURE_KEYS.grammarDetail];

describe("resolveEntitlements", () => {
  it("gives free (product) 20 translations/month, 3 lifetime videos, no features", () => {
    const e = resolveEntitlements({ audienceGroup: "product", plan: "free", planConfig: FREE, planFeatures: [] });
    expect(e.translationsPerMonth).toBe(20);
    expect(e.video).toEqual({ limit: 3, window: "lifetime" });
    expect(e.features.size).toBe(0);
  });

  it("gives plus unlimited translations, 10 monthly videos, premium features", () => {
    const e = resolveEntitlements({
      audienceGroup: "product",
      plan: "plus",
      planConfig: PLUS,
      planFeatures: PREMIUM_FEATURES,
    });
    expect(e.translationsPerMonth).toBeNull();
    expect(e.video).toEqual({ limit: 10, window: "monthly" });
    expect(e.features.has(FEATURE_KEYS.etymology)).toBe(true);
  });

  it("gives pro unlimited translations and unlimited videos", () => {
    const e = resolveEntitlements({
      audienceGroup: "product",
      plan: "pro",
      planConfig: PRO,
      planFeatures: PREMIUM_FEATURES,
    });
    expect(e.translationsPerMonth).toBeNull();
    expect(e.video.limit).toBeNull();
    expect(e.video.window).toBe("monthly");
  });

  it.each([
    "admin",
    "tester",
  ] as const)("role %s overrides the plan → unlimited everything + all features, even on free", (audienceGroup) => {
    const e = resolveEntitlements({ audienceGroup, plan: "free", planConfig: FREE, planFeatures: [] });
    expect(e.translationsPerMonth).toBeNull();
    expect(e.video.limit).toBeNull();
    expect(e.video.window).not.toBe("none");
    expect([...e.features].sort()).toEqual([...ALL_FEATURES].sort());
  });

  it("falls back to free entitlements when the plan config is missing", () => {
    const e = resolveEntitlements({ audienceGroup: "product", plan: "free", planConfig: null, planFeatures: [] });
    expect(e.translationsPerMonth).toBe(20);
    expect(e.video).toEqual({ limit: 3, window: "lifetime" });
  });

  it("does not grant plan features that are role-only (mechanism present)", () => {
    // With no role-only features configured, plan features pass through unchanged.
    const e = resolveEntitlements({
      audienceGroup: "product",
      plan: "plus",
      planConfig: PLUS,
      planFeatures: PREMIUM_FEATURES,
    });
    expect(e.features.size).toBe(PREMIUM_FEATURES.length);
  });
});
