/**
 * Spec for the momentum math (plan §3.2–3.4, §8.2.1).
 *
 * These are the properties the whole feature rests on: decay is closed-form,
 * crediting is commutative (which is what makes backfill and replay safe), the
 * daily cap is expressed as weight, and "day" means the user's local day.
 */
import { describe, expect, it } from "vitest";
import {
  activeDaysFromEvents,
  applyEffort,
  cappedWeight,
  decay,
  localDayBounds,
  localDayKey,
  resolveBand,
} from "../momentum.math.js";
import { BAND_THRESHOLDS, HALF_LIFE_MS } from "../momentum.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

describe("decay", () => {
  it("halves the score after exactly one half-life", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const to = new Date(from.getTime() + HALF_LIFE_MS);
    expect(relativeError(decay(42, from, to), 21)).toBeLessThan(1e-9);
  });

  it("costs 9% for one skipped day and 50% for a skipped week", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(decay(100, from, new Date(from.getTime() + DAY_MS))).toBeCloseTo(90.6, 1);
    expect(decay(100, from, new Date(from.getTime() + 7 * DAY_MS))).toBeCloseTo(50, 6);
  });
});

describe("applyEffort", () => {
  const t0 = new Date("2026-03-01T09:00:00.000Z");
  const t2 = new Date(t0.getTime() + 2 * DAY_MS);

  it("gives the same score whichever order two events are applied in", () => {
    const start = { score: 0, scoredAt: t0 };
    const commonInstant = new Date(t0.getTime() + 30 * DAY_MS);

    const forward = applyEffort(applyEffort(start, 1, t0), 3, t2);
    const reversed = applyEffort(applyEffort(start, 3, t2), 1, t0);

    const a = decay(forward.score, forward.scoredAt, commonInstant);
    const b = decay(reversed.score, reversed.scoredAt, commonInstant);
    expect(relativeError(a, b)).toBeLessThan(1e-9);
  });

  it("discounts a late event forward without rewinding scoredAt", () => {
    const state = { score: 10, scoredAt: t2 };
    const late = applyEffort(state, 4, t0);

    expect(late.scoredAt).toEqual(t2);
    expect(relativeError(late.score, 10 + 4 * 2 ** (-2 / 7))).toBeLessThan(1e-9);
  });

  it("decays the standing score before adding a later event", () => {
    const state = { score: 10, scoredAt: t0 };
    const next = applyEffort(state, 3, t2);

    expect(next.scoredAt).toEqual(t2);
    expect(relativeError(next.score, 10 * 2 ** (-2 / 7) + 3)).toBeLessThan(1e-9);
  });
});

describe("resolveBand", () => {
  it("includes the lower bound of every band and excludes the one below it", () => {
    expect(resolveBand(BAND_THRESHOLDS.warming - 0.0001)).toBe("resting");
    expect(resolveBand(BAND_THRESHOLDS.warming)).toBe("warming");
    expect(resolveBand(BAND_THRESHOLDS.steady - 0.0001)).toBe("warming");
    expect(resolveBand(BAND_THRESHOLDS.steady)).toBe("steady");
    expect(resolveBand(BAND_THRESHOLDS.strong - 0.0001)).toBe("steady");
    expect(resolveBand(BAND_THRESHOLDS.strong)).toBe("strong");
  });

  it("puts an empty score in the lowest band", () => {
    expect(resolveBand(0)).toBe("resting");
  });
});

describe("cappedWeight", () => {
  it("pays the third translate of the day and nothing for the fourth", () => {
    expect(cappedWeight("translate", 0)).toBe(1);
    expect(cappedWeight("translate", 2)).toBe(1);
    expect(cappedWeight("translate", 3)).toBe(0);
  });

  it("pays the second save of the day and nothing for the third", () => {
    expect(cappedWeight("save", 0)).toBe(2);
    expect(cappedWeight("save", 2)).toBe(2);
    expect(cappedWeight("save", 4)).toBe(0);
  });

  it("makes a 10-card session worth the same as a 2-card one", () => {
    expect(cappedWeight("review", 0)).toBe(3);
    expect(cappedWeight("review", 3)).toBe(3);
    expect(cappedWeight("review", 6)).toBe(0);
    expect(cappedWeight("mentor_turn", 6)).toBe(0);
  });

  it("never caps mature", () => {
    expect(cappedWeight("mature", 0)).toBe(10);
    expect(cappedWeight("mature", 1000)).toBe(10);
  });
});

describe("local day", () => {
  // Both instants are 01:30 and 02:30 in Berlin on the same summer night, but
  // they straddle midnight UTC — bucketing by UTC would split the daily cap.
  const beforeUtcMidnight = new Date("2026-07-01T23:30:00.000Z");
  const afterUtcMidnight = new Date("2026-07-02T00:30:00.000Z");

  it("keeps a Berlin summer night in one local day", () => {
    expect(localDayKey("Europe/Berlin", beforeUtcMidnight)).toBe("2026-07-02");
    expect(localDayKey("Europe/Berlin", afterUtcMidnight)).toBe("2026-07-02");
  });

  it("returns the same bounds for both, spanning local midnight to local midnight", () => {
    const first = localDayBounds("Europe/Berlin", beforeUtcMidnight);
    const second = localDayBounds("Europe/Berlin", afterUtcMidnight);

    expect(first.start.toISOString()).toBe("2026-07-01T22:00:00.000Z");
    expect(first.end.toISOString()).toBe("2026-07-02T22:00:00.000Z");
    expect(second).toEqual(first);
    for (const at of [beforeUtcMidnight, afterUtcMidnight]) {
      expect(at.getTime()).toBeGreaterThanOrEqual(first.start.getTime());
      expect(at.getTime()).toBeLessThan(first.end.getTime());
    }
  });

  it("keeps the day 24 hours long across a DST spring-forward day", () => {
    const { start, end } = localDayBounds("Europe/Berlin", new Date("2026-03-29T12:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("falls back to UTC for an unusable timezone instead of throwing", () => {
    expect(localDayKey("Not/AZone", beforeUtcMidnight)).toBe("2026-07-01");
  });
});

describe("activeDaysFromEvents", () => {
  it("counts distinct local days that carried real weight", () => {
    const events = [
      { occurredAt: new Date("2026-07-01T23:30:00.000Z"), weight: 1 },
      { occurredAt: new Date("2026-07-02T00:30:00.000Z"), weight: 1 },
      { occurredAt: new Date("2026-07-03T10:00:00.000Z"), weight: 3 },
      { occurredAt: new Date("2026-07-04T10:00:00.000Z"), weight: 0 },
    ];
    expect(activeDaysFromEvents(events, "Europe/Berlin", new Date("2026-07-01T00:00:00.000Z"))).toBe(2);
  });

  it("ignores events older than the window", () => {
    const events = [{ occurredAt: new Date("2026-06-01T10:00:00.000Z"), weight: 3 }];
    expect(activeDaysFromEvents(events, "UTC", new Date("2026-07-01T00:00:00.000Z"))).toBe(0);
  });
});
