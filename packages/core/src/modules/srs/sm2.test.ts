import { describe, expect, it } from "vitest";
import { applySm2Review, initialSrsDueDate } from "./sm2.js";

describe("SM-2 SRS scheduling", () => {
  const now = new Date("2026-06-04T10:00:00.000Z");

  it("schedules new saved cards for first review tomorrow", () => {
    expect(initialSrsDueDate(now).toISOString()).toBe("2026-06-05T10:00:00.000Z");
  });

  it("schedules first good review one day out", () => {
    const result = applySm2Review(
      {
        easeFactor: 2.5,
        interval: 0,
        reviewCount: 0,
        dueDate: null,
      },
      "good",
      now,
    );

    expect(result.interval).toBe(1);
    expect(result.reviewCount).toBe(1);
    expect(result.easeFactor).toBe(2.5);
    expect(result.dueDate?.toISOString()).toBe("2026-06-05T10:00:00.000Z");
  });

  it("increases interval and ease on easy rating", () => {
    const result = applySm2Review(
      {
        easeFactor: 2.5,
        interval: 6,
        reviewCount: 2,
        dueDate: now,
      },
      "easy",
      now,
    );

    expect(result.interval).toBe(20);
    expect(result.easeFactor).toBe(2.65);
    expect(result.reviewCount).toBe(3);
  });

  it("keeps ease factor above the minimum after repeated failures", () => {
    const result = applySm2Review(
      {
        easeFactor: 1.31,
        interval: 10,
        reviewCount: 5,
        dueDate: now,
      },
      "again",
      now,
    );

    expect(result.interval).toBe(1);
    expect(result.easeFactor).toBe(1.3);
  });
});
