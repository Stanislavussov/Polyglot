/**
 * Which badge a locked button wears.
 *
 * One ⭐ for every paid button was a promise the upgrade screen then broke: word
 * audio is Pro-only, so a starred speaker sent the reader to a $5 Plus offer that
 * could never unlock it. The badge is now the glyph of the cheapest tier on sale
 * that grants the feature, which is the same tier the offer opens by naming.
 */
import { FEATURE_KEYS, type PlanLimitConfig, type ServiceContainer } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { createServicesStub, createSettingsStub } from "../../../test-helpers/services-stub.js";
import type { BotContext } from "../../../types.js";
import { resolveLockedBadges } from "../paid-feature.helper.js";

const PLAN_FEATURES: Record<string, string[]> = {
  free: [],
  plus: [FEATURE_KEYS.clarification, FEATURE_KEYS.grammarBreakdown, FEATURE_KEYS.mentor],
  pro: [
    FEATURE_KEYS.clarification,
    FEATURE_KEYS.grammarBreakdown,
    FEATURE_KEYS.mentor,
    FEATURE_KEYS.pronunciation,
    FEATURE_KEYS.voiceInput,
  ],
};

function plan(name: string, priceUsdCents: number | null): PlanLimitConfig {
  return {
    name,
    label: name[0]!.toUpperCase() + name.slice(1),
    translationLimit: name === "free" ? 10 : null,
    creditCost: 1,
    videoLimit: name === "free" ? 0 : null,
    videoWindow: name === "free" ? "none" : "monthly",
    mentorDailyLimit: null,
    priceUsdCents,
    isActive: true,
    isDefault: name === "free",
  };
}

const LADDER = [plan("free", null), plan("plus", 500), plan("pro", 1000)];

function createCtx(opts: { granted: string[]; plans?: PlanLimitConfig[] }) {
  return {
    user: { id: 1, audienceGroup: "product", subscriptionPlan: "free" },
    services: createServicesStub({
      settings: {
        ...createSettingsStub(),
        getPlanLimits: vi.fn().mockResolvedValue(opts.plans ?? LADDER),
      },
      featureAccess: {
        listFeatures: vi.fn().mockResolvedValue(new Set(opts.granted)),
        listPlanFeatures: vi.fn(async (name: string) => new Set(PLAN_FEATURES[name] ?? [])),
        checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: false }),
      } as unknown as ServiceContainer["featureAccess"],
    }),
  } as unknown as BotContext;
}

describe("resolveLockedBadges", () => {
  it("gives each locked feature the glyph of the cheapest tier that sells it", async () => {
    const badges = await resolveLockedBadges(createCtx({ granted: [] }));

    expect(badges.get(FEATURE_KEYS.clarification)).toBe("⭐");
    expect(badges.get(FEATURE_KEYS.grammarBreakdown)).toBe("⭐");
    expect(badges.get(FEATURE_KEYS.pronunciation)).toBe("💎");
    expect(badges.get(FEATURE_KEYS.voiceInput)).toBe("💎");
  });

  it("badges what a Plus subscriber still cannot do with Pro's glyph", async () => {
    const badges = await resolveLockedBadges(createCtx({ granted: PLAN_FEATURES.plus! }));

    expect(badges.get(FEATURE_KEYS.pronunciation)).toBe("💎");
    expect(badges.get(FEATURE_KEYS.voiceInput)).toBe("💎");
    // What Plus already pays for carries no badge at all.
    expect(badges.has(FEATURE_KEYS.clarification)).toBe(false);
    expect(badges.has(FEATURE_KEYS.mentor)).toBe(false);
    // etymology/grammarDetail are unsold in this catalogue — locked, but with no
    // tier to point at, so they get the neutral glyph rather than a false 💎.
    expect(badges.get(FEATURE_KEYS.etymology)).toBe("✨");
  });

  it("badges nothing — and reads no plan — for a viewer who has everything", async () => {
    const ctx = createCtx({ granted: Object.values(FEATURE_KEYS) });

    expect(await resolveLockedBadges(ctx)).toEqual(new Map());
    expect(ctx.services.settings.getPlanLimits).not.toHaveBeenCalled();
  });

  it("falls back to the neutral glyph when no plan is on sale yet", async () => {
    const badges = await resolveLockedBadges(
      createCtx({ granted: [], plans: [plan("free", null), plan("plus", null)] }),
    );

    expect(badges.get(FEATURE_KEYS.clarification)).toBe("✨");
  });
});
