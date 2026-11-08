import { describe, expect, it, vi } from "vitest";
import type { FeatureAccessPort } from "../../ports/feature-access.port.js";
import { FEATURE_KEYS } from "./entitlements.js";
import { resolveFeatureStates } from "./feature-state.js";

const subject = { audienceGroup: "product", subscriptionPlan: "free" } as const;

function accessGranting(...features: string[]): FeatureAccessPort {
  return {
    listFeatures: vi.fn(async () => new Set(features)),
    listPlanFeatures: vi.fn(async () => new Set<string>()),
    checkFeatureAccess: vi.fn(async () => ({ hasAccess: false })),
  };
}

describe("resolveFeatureStates", () => {
  it("marks granted features ok and the rest locked, from one plan lookup", async () => {
    const access = accessGranting(FEATURE_KEYS.etymology);
    const states = await resolveFeatureStates(access, subject, [FEATURE_KEYS.etymology, FEATURE_KEYS.mentor]);

    expect(Object.fromEntries(states)).toEqual({ etymology: "ok", mentor: "locked" });
    expect(access.listFeatures).toHaveBeenCalledTimes(1);
  });

  it("reports a feature switched off for everyone as off, even when the plan grants it", async () => {
    const access = accessGranting(FEATURE_KEYS.pronunciation);
    const states = await resolveFeatureStates(
      access,
      subject,
      [FEATURE_KEYS.pronunciation],
      new Set([FEATURE_KEYS.pronunciation]),
    );

    expect(states.get(FEATURE_KEYS.pronunciation)).toBe("off");
  });
});
