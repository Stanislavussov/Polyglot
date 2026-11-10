/**
 * The goal ladder's copy, rendered once for every channel: the bot's /progress, the
 * web Progress tab and the web's thin goal bar say the same thing in the same words.
 */
import { t } from "../i18n/i18n.js";
import type { I18nKey, SupportedLang } from "../i18n/types.js";
import type { MomentumBand } from "./momentum.types.js";
import type { ProgressView } from "./progress.service.js";
import type { ProgressGoalType } from "./progress-goals.js";

const GOAL_KEY: Record<ProgressGoalType, Record<MomentumBand, I18nKey>> = {
  day: {
    resting: "progressGoalDayResting",
    warming: "progressGoalDayWarming",
    steady: "progressGoalDaySteady",
    strong: "progressGoalDayStrong",
  },
  week: {
    resting: "progressGoalWeekResting",
    warming: "progressGoalWeekWarming",
    steady: "progressGoalWeekSteady",
    strong: "progressGoalWeekStrong",
  },
  month: {
    resting: "progressGoalMonthResting",
    warming: "progressGoalMonthWarming",
    steady: "progressGoalMonthSteady",
    strong: "progressGoalMonthStrong",
  },
};

export interface ProgressLadderCopy {
  /** Counted months, this month, next milestone, today's cards. */
  lines: string[];
  /** The one band-specific next step. */
  nearest: string;
  /** One gift line per reward granted by the call that built the view. */
  rewards: string[];
}

function planName(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function renderProgressLadder(view: ProgressView, band: MomentumBand, lang: SupportedLang): ProgressLadderCopy {
  const months =
    view.countedMonths === 0
      ? t("progressGoalMonthsFirst", lang)
      : t("progressGoalMonths", lang, { count: view.cycleMonths, total: view.monthsForReward });
  return {
    lines: [
      months,
      t("progressGoalMonth", lang, {
        days: view.month.activeDays,
        minDays: view.month.minActiveDays,
        mature: view.month.matureGained,
        saved: view.month.savedGained,
      }),
      view.milestone
        ? t("progressGoalMilestone", lang, { target: view.milestone.target, remaining: view.milestone.remaining })
        : t("progressGoalMilestonesAll", lang),
      view.day.done
        ? t("progressGoalDayDone", lang)
        : t("progressGoalDayTodo", lang, { reviews: view.day.reviews, target: view.day.target }),
    ],
    nearest: t(GOAL_KEY[view.goal][band], lang, {
      days: view.week.days,
      target: view.goal === "week" ? view.week.target : view.day.target,
    }),
    rewards: view.freshRewards.map((grant) =>
      grant.action === "extend"
        ? t("progressRewardExtended", lang, { days: grant.days })
        : t("progressRewardCreated", lang, { plan: planName(grant.plan) }),
    ),
  };
}
