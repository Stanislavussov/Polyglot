/**
 * Spec for the shared `isFinitePositive` budget guard. It is the single predicate
 * every time-budget consumer funnels through, so a non-finite/non-positive value
 * can never reach `setTimeout` (which treats NaN as 0 and fires immediately).
 */
import { describe, expect, it } from "vitest";
import { isFinitePositive } from "../numbers.js";

describe("isFinitePositive", () => {
  it("accepts finite numbers strictly greater than zero", () => {
    for (const n of [1, 0.5, 15_000, 20_000, Number.MAX_SAFE_INTEGER]) {
      expect(isFinitePositive(n)).toBe(true);
    }
  });

  it("rejects NaN, Infinity, zero, negatives and non-numbers", () => {
    for (const v of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -0,
      -1,
      -0.001,
      undefined,
      null,
      "15000",
      {},
      [],
    ]) {
      expect(isFinitePositive(v)).toBe(false);
    }
  });
});
