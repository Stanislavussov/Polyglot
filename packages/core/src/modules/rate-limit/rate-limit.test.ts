import { describe, expect, it } from "vitest";
import type { PlanLimit } from "./index.js";
import { evaluatePlanRateLimit } from "./index.js";

const freeLimit: PlanLimit = { plan: "free", label: "Free", creditsPerDay: 50 };
const unlimited: PlanLimit = { plan: "unlimited", label: "Unlimited", creditsPerDay: null };

describe("rate-limit policy", () => {
  it("blocks finite plans when requested credits exceed remaining credits", () => {
    const status = evaluatePlanRateLimit(freeLimit, 50, 1, new Date("2026-01-01T00:00:00Z"));

    expect(status.allowed).toBe(false);
    expect(status.remainingCredits).toBe(0);
  });

  it("allows a finite plan while credits remain", () => {
    const status = evaluatePlanRateLimit(freeLimit, 10, 5, new Date("2026-01-01T00:00:00Z"));

    expect(status.allowed).toBe(true);
    expect(status.remainingCredits).toBe(40);
  });

  it("allows unlimited plans regardless of used credits", () => {
    const status = evaluatePlanRateLimit(unlimited, 1_000_000, 500, new Date("2026-01-01T00:00:00Z"));

    expect(status.allowed).toBe(true);
    expect(status.remainingCredits).toBeNull();
  });
});
