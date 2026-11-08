import { describe, expect, it, vi } from "vitest";
import type { PlanLimitConfig, SettingsPort } from "../../ports/settings.port.js";
import { AI_CALL_WEIGHTS, checkAiQuota, checkTranslationQuota, recordAiUsage, resolvePlanLimit } from "./quota.js";

const free: PlanLimitConfig = {
  name: "free",
  label: "Free",
  translationLimit: 50,
  creditCost: 1,
  videoLimit: 3,
  videoWindow: "lifetime",
  mentorDailyLimit: null,
  grammarCheckDailyLimit: null,
  priceUsdCents: null,
  isActive: true,
  isDefault: true,
};
const pro: PlanLimitConfig = { ...free, name: "pro", label: "Pro", translationLimit: 1500, isDefault: false };

function settingsWith(getPlanLimit: unknown, getPlanLimits: unknown): SettingsPort {
  return { getPlanLimit, getPlanLimits } as unknown as SettingsPort;
}

describe("resolvePlanLimit", () => {
  it("returns the plan config directly when the settings source knows it", async () => {
    const settings = settingsWith(vi.fn().mockResolvedValue(pro), vi.fn());

    const result = await resolvePlanLimit(settings, "pro");

    expect(result).toEqual(pro);
    expect(settings.getPlanLimits).not.toHaveBeenCalled();
  });

  it("falls back to the default plan when the plan name is unknown", async () => {
    const settings = settingsWith(vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue([pro, free]));

    const result = await resolvePlanLimit(settings, "mystery-tier");

    expect(result).toEqual(free); // free is isDefault
  });

  it("falls back to the first plan when none is marked default", async () => {
    const noDefault = { ...free, isDefault: false };
    const settings = settingsWith(vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue([noDefault, pro]));

    const result = await resolvePlanLimit(settings, "mystery-tier");

    expect(result).toEqual(noDefault);
  });

  it("throws when the settings source has no plans at all", async () => {
    const settings = settingsWith(vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue([]));

    await expect(resolvePlanLimit(settings, "free")).rejects.toThrow(/no plan limits configured/i);
  });
});

describe("quota decisions", () => {
  function ports(used: number, plan: PlanLimitConfig | null) {
    const settings = settingsWith(vi.fn().mockResolvedValue(plan), vi.fn().mockResolvedValue([free]));
    return {
      settings,
      translationRequests: {
        getUserCreditsInWindow: vi.fn().mockResolvedValue(used),
        logTranslationRequest: vi.fn().mockResolvedValue(1),
        countRequestsInWindow: vi.fn().mockResolvedValue(0),
      },
    };
  }
  const learner = { id: 7, audienceGroup: "product" as const, subscriptionPlan: "free" as const };

  it("allows a translation under the monthly allowance", async () => {
    expect(await checkTranslationQuota(ports(49, free), learner)).toEqual({ ok: true, creditCost: 1 });
  });

  it("refuses the translation that would pass the monthly allowance, as a plan refusal", async () => {
    const decision = await checkTranslationQuota(ports(50, free), learner);
    expect(decision).toMatchObject({ ok: false, reason: "plan" });
  });

  it("still applies the daily ceiling to an unlimited plan", async () => {
    const unlimited = { ...free, translationLimit: null, dailyCreditCeiling: 5 };
    const decision = await checkTranslationQuota(ports(5, unlimited), learner);
    expect(decision).toMatchObject({ ok: false, reason: "daily_ceiling", ceiling: 5 });
  });

  it("charges an AI call its weight times the plan's credit cost", async () => {
    const decision = await checkAiQuota(ports(0, { ...free, creditCost: 2 }), learner, "video");
    expect(decision).toEqual({ ok: true, creditCost: 2 * AI_CALL_WEIGHTS.video });
  });

  it("lets an internal role past the plan limit but not the ceiling", async () => {
    const tester = { ...learner, audienceGroup: "tester" as const };
    expect(await checkAiQuota(ports(50, free), tester, "translate")).toMatchObject({ ok: true });
    expect(await checkAiQuota(ports(10_000, free), tester, "translate")).toMatchObject({ reason: "daily_ceiling" });
  });

  it("bills the ledger with the call-type tag", async () => {
    const p = ports(0, free);
    await recordAiUsage(p, 7, "mentor", 2, "en", ["de"]);
    expect(p.translationRequests.logTranslationRequest).toHaveBeenCalledWith(7, "[mentor]", "en", ["de"], 2);
  });
});
