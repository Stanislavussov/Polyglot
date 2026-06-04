import { describe, expect, it } from "vitest";
import { calculateTranslationCreditCost, evaluateRateLimit, getPlanLimit } from "./index.js";

describe("rate-limit policy", () => {
  it("charges one credit per incoming user translation request", () => {
    expect(calculateTranslationCreditCost()).toBe(1);
  });

  it("blocks finite plans when requested credits exceed remaining credits", () => {
    const status = evaluateRateLimit("free", 50, 1, new Date("2026-01-01T00:00:00Z"));

    expect(status.allowed).toBe(false);
    expect(status.remainingCredits).toBe(0);
  });

  it("allows unlimited plans regardless of used credits", () => {
    const status = evaluateRateLimit("unlimited", 1_000_000, 500, new Date("2026-01-01T00:00:00Z"));

    expect(status.allowed).toBe(true);
    expect(status.remainingCredits).toBeNull();
    expect(getPlanLimit("unlimited").creditsPerDay).toBeNull();
  });
});
