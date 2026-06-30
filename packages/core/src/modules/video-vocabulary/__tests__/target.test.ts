import { describe, expect, it } from "vitest";
import { computePhraseTarget } from "../target.js";

const MIN = 15;
const MAX = 40;

describe("computePhraseTarget", () => {
  it("anchors to the product spec: ~20 at 30min, ~30 at 1h, ~40 at 2h", () => {
    expect(computePhraseTarget(30 * 60, MIN, MAX)).toBe(20);
    expect(computePhraseTarget(60 * 60, MIN, MAX)).toBe(30);
    expect(computePhraseTarget(120 * 60, MIN, MAX)).toBe(40);
  });

  it("clamps short videos to the minimum", () => {
    expect(computePhraseTarget(5 * 60, MIN, MAX)).toBe(MIN);
    expect(computePhraseTarget(15 * 60, MIN, MAX)).toBe(MIN);
  });

  it("clamps very long videos to the maximum", () => {
    expect(computePhraseTarget(240 * 60, MIN, MAX)).toBe(MAX);
    expect(computePhraseTarget(600 * 60, MIN, MAX)).toBe(MAX);
  });

  it("falls back to the baseline when duration is unknown", () => {
    expect(computePhraseTarget(0, MIN, MAX)).toBe(20);
    expect(computePhraseTarget(-100, MIN, MAX)).toBe(20);
  });

  it("respects admin-configured min/max bounds", () => {
    // Tighter window forces the baseline down to the configured ceiling.
    expect(computePhraseTarget(60 * 60, 10, 25)).toBe(25);
    // Higher floor lifts short videos.
    expect(computePhraseTarget(5 * 60, 22, 50)).toBe(22);
  });

  it("never exceeds the bounds even if min > max is misconfigured", () => {
    const result = computePhraseTarget(60 * 60, 40, 15);
    expect(result).toBeGreaterThanOrEqual(15);
    expect(result).toBeLessThanOrEqual(40);
  });
});
