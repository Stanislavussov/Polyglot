import { describe, expect, it } from "vitest";
import { t } from "../../i18n/i18n.js";
import type { ProgressView } from "../progress.service.js";
import { renderProgressLadder } from "../progress-copy.js";

const VIEW: ProgressView = {
  countedMonths: 2,
  monthsForReward: 5,
  cycleMonths: 2,
  month: { activeDays: 7, matureGained: 1, savedGained: 3, counted: false, minActiveDays: 12, minNewWords: 10 },
  milestone: { target: 50, remaining: 6 },
  day: { done: false, reviews: 2, target: 5 },
  week: { met: false, days: 2, target: 4 },
  goal: "day",
  freshRewards: [],
};

describe("renderProgressLadder", () => {
  it("renders the four ladder lines and the band's nearest step", () => {
    const copy = renderProgressLadder(VIEW, "warming", "en");

    expect(copy.lines).toEqual([
      t("progressGoalMonths", "en", { count: 2, total: 5 }),
      t("progressGoalMonth", "en", { days: 7, minDays: 12, mature: 1, saved: 3 }),
      t("progressGoalMilestone", "en", { target: 50, remaining: 6 }),
      t("progressGoalDayTodo", "en", { reviews: 2, target: 5 }),
    ]);
    expect(copy.nearest).toBe(t("progressGoalDayWarming", "en"));
    expect(copy.rewards).toEqual([]);
  });

  it("opens a first cycle kindly and names each fresh gift", () => {
    const copy = renderProgressLadder(
      {
        ...VIEW,
        countedMonths: 0,
        freshRewards: [
          { cycle: 1, plan: "plus", action: "create", days: 30, currentPeriodEnd: new Date() },
          { cycle: 2, plan: "plus", action: "extend", days: 30, currentPeriodEnd: new Date() },
        ],
      },
      "steady",
      "en",
    );

    expect(copy.lines[0]).toBe(t("progressGoalMonthsFirst", "en"));
    expect(copy.rewards).toEqual([
      t("progressRewardCreated", "en", { plan: "Plus" }),
      t("progressRewardExtended", "en", { days: 30 }),
    ]);
  });
});
