/**
 * Guard for the "word is stuck" threshold (plan §3.10).
 *
 * `MATURE_INTERVAL_DAYS = 21` is not a free parameter: it is chosen so that the
 * threshold falls between the third and fourth SM-2 "good", i.e. it means "recalled
 * it three weeks later". If the sm2.ts constants move, that meaning silently changes —
 * so this test reads the ladder from the real implementation and fails when it does.
 */
import { describe, expect, it } from "vitest";
import { applySm2Review } from "../../srs/sm2.js";
import type { SrsState } from "../../srs/types.js";
import { MATURE_INTERVAL_DAYS } from "../momentum.types.js";

describe("mature threshold vs the SM-2 ladder", () => {
  it("crosses on the fourth consecutive good, 22 calendar days after the first", () => {
    let state: SrsState = {
      easeFactor: 2.5,
      interval: 0,
      reviewCount: 0,
      dueDate: new Date("2026-01-01T00:00:00.000Z"),
    };
    const intervals: number[] = [];

    for (let i = 0; i < 4; i++) {
      const result = applySm2Review(state, "good", new Date("2026-01-01T00:00:00.000Z"));
      intervals.push(result.interval);
      state = {
        easeFactor: result.easeFactor,
        interval: result.interval,
        reviewCount: result.reviewCount,
        dueDate: result.dueDate,
      };
    }

    expect(intervals).toEqual([1, 6, 15, 38]);
    expect(intervals[2]).toBeLessThan(MATURE_INTERVAL_DAYS);
    expect(intervals[3]).toBeGreaterThanOrEqual(MATURE_INTERVAL_DAYS);
    expect(intervals[0] + intervals[1] + intervals[2]).toBe(22);
  });
});
