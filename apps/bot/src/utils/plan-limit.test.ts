import type { PlanLimitConfig, SettingsPort } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { resolvePlanLimit } from "./plan-limit.js";

const free: PlanLimitConfig = {
  name: "free",
  label: "Free",
  creditsPerDay: 50,
  windowMs: 86_400_000,
  creditCost: 1,
  isActive: true,
  isDefault: true,
};
const pro: PlanLimitConfig = { ...free, name: "pro", label: "Pro", creditsPerDay: 1500, isDefault: false };

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
