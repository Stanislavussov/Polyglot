/**
 * Spec for the goal ladder's pure rules (plan `progress-goal-ladder` rev 4, step 1).
 *
 * Live view, month close and backfill all call these same functions, so a month
 * counted here is counted the same way everywhere.
 */
import { describe, expect, it } from "vitest";
import {
  activityStats,
  cyclesToClaim,
  DEFAULT_PROGRESS_GOALS,
  dayTaskState,
  grantAction,
  isActiveDayKind,
  isMonthCounted,
  longestHeldPlan,
  milestonesReached,
  monthBounds,
  monthKey,
  monthsBetween,
  nearestGoal,
  nextMilestone,
  type PlanInterval,
  planDaysForMonth,
  previousMonth,
  rhythmWeek,
} from "../progress-goals.js";

const cfg = DEFAULT_PROGRESS_GOALS;

describe("isActiveDayKind", () => {
  it("counts review, save and mature — never presence or tokens", () => {
    expect(["review", "save", "mature"].every((kind) => isActiveDayKind(kind))).toBe(true);
    for (const kind of ["translate", "mentor_turn", "praise", "weekly_proof", "reward", "milestone"]) {
      expect(isActiveDayKind(kind)).toBe(false);
    }
  });
});

describe("isMonthCounted", () => {
  const cases: Array<[number, number, number, boolean]> = [
    // activeDays, mature, saved, counted
    [12, 1, 0, true],
    [12, 0, 10, true],
    [11, 5, 50, false],
    [12, 0, 9, false],
    [0, 0, 0, false],
    [30, 0, 0, false],
    [11, 0, 0, false],
    [20, 3, 20, true],
  ];
  it.each(cases)("activeDays=%i mature=%i saved=%i → %s", (activeDays, matureGained, savedGained, counted) => {
    expect(isMonthCounted({ activeDays, matureGained, savedGained }, cfg)).toBe(counted);
  });
});

describe("activityStats", () => {
  it("counts distinct local days of learning events and the vocabulary growth inside the range", () => {
    const from = new Date("2026-10-01T00:00:00.000Z");
    const to = new Date("2026-11-01T00:00:00.000Z");
    const stats = activityStats(
      [
        { kind: "review", occurredAt: new Date("2026-10-02T08:00:00.000Z") },
        { kind: "review", occurredAt: new Date("2026-10-02T09:00:00.000Z") },
        { kind: "save", occurredAt: new Date("2026-10-03T08:00:00.000Z") },
        { kind: "mature", occurredAt: new Date("2026-10-04T08:00:00.000Z") },
        { kind: "translate", occurredAt: new Date("2026-10-05T08:00:00.000Z") },
        { kind: "mentor_turn", occurredAt: new Date("2026-10-06T08:00:00.000Z") },
        { kind: "save", occurredAt: new Date("2026-11-01T00:00:00.000Z") },
      ],
      "UTC",
      from,
      to,
    );
    expect(stats).toEqual({ activeDays: 3, matureGained: 1, savedGained: 1 });
  });

  it("buckets by the user's local day", () => {
    const stats = activityStats(
      [
        { kind: "review", occurredAt: new Date("2026-10-02T22:30:00.000Z") },
        { kind: "review", occurredAt: new Date("2026-10-03T05:00:00.000Z") },
      ],
      "Europe/Prague",
      new Date("2026-10-01T00:00:00.000Z"),
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(stats.activeDays).toBe(1);
  });
});

describe("month keys", () => {
  it("uses the user's timezone and falls back to UTC on garbage", () => {
    const at = new Date("2026-10-31T23:30:00.000Z");
    expect(monthKey(at, "UTC")).toBe("2026-10");
    expect(monthKey(at, "Europe/Prague")).toBe("2026-11");
    expect(monthKey(at, "Not/AZone")).toBe("2026-10");
  });

  it("bounds a month at local midnight", () => {
    const { start, end } = monthBounds("2026-11", "Europe/Prague");
    expect(start.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });

  it("steps back across a year and lists months in between", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthsBetween("2026-02", "2026-02")).toEqual([]);
  });
});

describe("planDaysForMonth", () => {
  const sub = (plan: string, provider: string, start: string, end: string): PlanInterval => ({
    plan,
    provider,
    start: new Date(start),
    end: new Date(end),
  });

  it("counts every day as free with no rows", () => {
    expect(planDaysForMonth([], "2026-02", "UTC")).toEqual({ free: 28, plus: 0, pro: 0, trial: 0 });
  });

  it("counts a trial as trial, never as Pro", () => {
    const days = planDaysForMonth(
      [sub("pro", "trial", "2026-02-01T00:00:00Z", "2026-02-08T00:00:00Z")],
      "2026-02",
      "UTC",
    );
    expect(days).toEqual({ free: 21, plus: 0, pro: 0, trial: 7 });
  });

  it("prefers paid over reward over trial on overlapping days", () => {
    const days = planDaysForMonth(
      [
        sub("pro", "trial", "2026-02-01T00:00:00Z", "2026-02-11T00:00:00Z"),
        sub("plus", "reward", "2026-02-06T00:00:00Z", "2026-02-16T00:00:00Z"),
        sub("pro", "mock", "2026-02-14T00:00:00Z", "2026-03-14T00:00:00Z"),
      ],
      "2026-02",
      "UTC",
    );
    expect(days).toEqual({ free: 0, plus: 8, pro: 15, trial: 5 });
  });

  it("ignores days before a row was created", () => {
    const days = planDaysForMonth(
      [sub("plus", "mock", "2026-02-20T00:00:00Z", "2026-03-20T00:00:00Z")],
      "2026-02",
      "UTC",
    );
    expect(days).toEqual({ free: 19, plus: 9, pro: 0, trial: 0 });
  });
});

describe("longestHeldPlan", () => {
  it("returns plus for a user who was free or on trial throughout", () => {
    expect(longestHeldPlan([{ free: 20, plus: 0, pro: 0, trial: 10 }])).toBe("plus");
  });

  it("sums across months and breaks a tie toward the higher tier", () => {
    expect(
      longestHeldPlan([
        { free: 0, plus: 30, pro: 0, trial: 0 },
        { free: 0, plus: 0, pro: 31, trial: 0 },
      ]),
    ).toBe("pro");
    expect(
      longestHeldPlan([
        { free: 0, plus: 20, pro: 10, trial: 0 },
        { free: 0, plus: 0, pro: 10, trial: 0 },
      ]),
    ).toBe("pro");
    expect(
      longestHeldPlan([
        { free: 0, plus: 21, pro: 10, trial: 0 },
        { free: 0, plus: 0, pro: 10, trial: 0 },
      ]),
    ).toBe("plus");
  });
});

describe("milestones", () => {
  it("names every milestone at or below the mature count", () => {
    expect(milestonesReached(9)).toEqual([]);
    expect(milestonesReached(50)).toEqual([10, 50]);
  });

  it("points at the next one and never steps back below a badge already earned", () => {
    expect(nextMilestone(44, [10])).toEqual({ target: 50, remaining: 6 });
    // Words lapsed from 52 to 44: the 50 badge stays, the next target is 100.
    expect(nextMilestone(44, [10, 50])).toEqual({ target: 100, remaining: 56 });
    expect(nextMilestone(600, [10, 50, 100, 250, 500])).toBeNull();
  });
});

describe("day and week", () => {
  it("is done at the configured number of reviews", () => {
    expect(dayTaskState(4, cfg)).toEqual({ done: false, reviews: 4, target: 5 });
    expect(dayTaskState(5, cfg).done).toBe(true);
  });

  it("is a rhythm week at four active days of seven", () => {
    expect(rhythmWeek(3, cfg)).toEqual({ met: false, days: 3, target: 4 });
    expect(rhythmWeek(4, cfg).met).toBe(true);
  });

  it("offers the smallest unmet step first", () => {
    expect(nearestGoal({ dayDone: false, weekMet: false })).toBe("day");
    expect(nearestGoal({ dayDone: true, weekMet: false })).toBe("week");
    expect(nearestGoal({ dayDone: true, weekMet: true })).toBe("month");
  });
});

describe("cyclesToClaim", () => {
  it("lists every completed cycle so a jump grants each one it skipped", () => {
    expect(cyclesToClaim(4, 5)).toEqual([]);
    expect(cyclesToClaim(5, 5)).toEqual([1]);
    expect(cyclesToClaim(10, 5)).toEqual([1, 2]);
  });
});

describe("grantAction", () => {
  it("creates, extends, replaces a trial, or defers on a real billing provider", () => {
    expect(grantAction(null)).toBe("create");
    expect(grantAction({ provider: "mock" })).toBe("extend");
    expect(grantAction({ provider: "reward" })).toBe("extend");
    expect(grantAction({ provider: "trial" })).toBe("replace_trial");
    expect(grantAction({ provider: "mollie" })).toBe("defer");
  });
});
