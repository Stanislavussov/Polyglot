import { describe, expect, it } from "vitest";
import { monthPace, progressInsights } from "./progress-insights";
import type { ProgressMetrics } from "./types";

// Spec: the Progress page splits the learner's state into "going well" and "to improve".
// - Each list holds at most 3 items, most important first.
// - Due cards always lead "to improve": they are the one action that pays off today.
// - A month is "on pace" when its active days keep up with the elapsed share of the month.
// - A brand-new learner (no words) gets a single "save your first word" step and no praise.

const base: ProgressMetrics = {
  band: "steady",
  words: 40,
  mature: 12,
  due: 0,
  activeDays: 10,
  ladder: {
    day: { reviews: 5, target: 5, done: true },
    week: { days: 4, target: 4, met: true },
    month: { activeDays: 6, minActiveDays: 12, mature: 2, saved: 3, minNewWords: 10, counted: false },
    cycleMonths: 1,
    monthsForReward: 5,
    rewardDays: 30,
    milestone: { target: 50, remaining: 38 },
  },
};

// The 10th of a 30-day month: a third of the month has passed.
const tenth = new Date(2026, 10, 10);

describe("monthPace", () => {
  it("expects active days in proportion to the elapsed month", () => {
    expect(monthPace({ activeDays: 4, minActiveDays: 12 }, tenth)).toEqual({ expected: 4, onPace: true });
    expect(monthPace({ activeDays: 3, minActiveDays: 12 }, tenth)).toEqual({ expected: 4, onPace: false });
  });
});

describe("progressInsights", () => {
  it("praises a met rhythm, a finished day and a month on pace", () => {
    const { good, improve } = progressInsights(base, tenth);
    expect(good.map((item) => item.key)).toEqual(["todayDone", "weekRhythm", "monthOnPace"]);
    expect(improve).toEqual([]);
  });

  it("puts due cards first in the to-improve list", () => {
    const metrics = { ...base, due: 7, ladder: { ...base.ladder!, day: { reviews: 1, target: 5, done: false } } };
    const { improve } = progressInsights(metrics, tenth);
    expect(improve[0]).toEqual({ key: "reviewDue", params: { count: 7 } });
    expect(improve.map((item) => item.key)).toContain("todayTodo");
  });

  it("flags a month behind pace and too few new words", () => {
    const metrics = {
      ...base,
      ladder: { ...base.ladder!, month: { ...base.ladder!.month, activeDays: 1, mature: 0, saved: 2 } },
    };
    const keys = progressInsights(metrics, tenth).improve.map((item) => item.key);
    expect(keys).toEqual(["monthBehind", "newWords"]);
  });

  it("counts a closed month as good even late in the month", () => {
    const metrics = { ...base, ladder: { ...base.ladder!, month: { ...base.ladder!.month, counted: true } } };
    expect(progressInsights(metrics, new Date(2026, 10, 29)).good.map((item) => item.key)).toContain("monthCounted");
  });

  it("falls back to long-term memory praise without a ladder", () => {
    const { good, improve } = progressInsights({ ...base, ladder: undefined, due: 3 }, tenth);
    expect(good.map((item) => item.key)).toEqual(["memory"]);
    expect(improve.map((item) => item.key)).toEqual(["reviewDue"]);
  });

  it("gives a new learner one first step and no praise", () => {
    expect(progressInsights({ ...base, words: 0, mature: 0, ladder: undefined }, tenth)).toEqual({
      good: [],
      improve: [{ key: "firstWord", params: {} }],
    });
  });

  it("caps each list at three items", () => {
    const metrics: ProgressMetrics = {
      ...base,
      due: 4,
      ladder: {
        ...base.ladder!,
        day: { reviews: 0, target: 5, done: false },
        week: { days: 1, target: 4, met: false },
        month: { ...base.ladder!.month, activeDays: 0, mature: 0, saved: 0 },
      },
    };
    expect(progressInsights(metrics, tenth).improve).toHaveLength(3);
  });
});
