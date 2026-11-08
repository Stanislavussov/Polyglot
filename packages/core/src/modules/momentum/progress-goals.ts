/**
 * Goal ladder rules (`/progress`): day task, rhythm week, word milestones, counted
 * months and the reward every N counted months. Pure — the live view, the month
 * close and the backfill all call these, so one month is judged one way everywhere.
 */
import { REWARD_PROVIDER, TRIAL_PROVIDER } from "../subscriptions/trial.js";
import { localDayKey, localMidnight } from "./momentum.math.js";
import { DEFAULT_MOTIVATION_CONFIG, type MotivationConfig } from "./momentum.types.js";

export interface ProgressGoalsConfig {
  enabled: boolean;
  minActiveDays: number;
  minNewWords: number;
  dayTaskReviews: number;
  rhythmDays: number;
  monthsForReward: number;
  rewardDays: number;
}

export function progressGoalsConfig(config: MotivationConfig): ProgressGoalsConfig {
  return {
    enabled: config.progressGoalsEnabled,
    minActiveDays: config.progressMinActiveDays,
    minNewWords: config.progressMinNewWords,
    dayTaskReviews: config.progressDayTaskReviews,
    rhythmDays: config.progressRhythmDays,
    monthsForReward: config.progressMonthsForReward,
    rewardDays: config.progressRewardDays,
  };
}

export const DEFAULT_PROGRESS_GOALS: ProgressGoalsConfig = progressGoalsConfig(DEFAULT_MOTIVATION_CONFIG);

/** Word milestones on words in long-term memory. */
export const PROGRESS_MILESTONES = [10, 50, 100, 250, 500] as const;

/**
 * Learning, not presence: `translate` is excluded so lookups cannot farm a month,
 * and `mentor_turn` because the mentor is Plus/Pro-only — a Free learner could
 * never use it to reach the same month.
 */
const ACTIVE_DAY_KINDS: ReadonlySet<string> = new Set(["review", "save", "mature"]);

export function isActiveDayKind(kind: string): boolean {
  return ACTIVE_DAY_KINDS.has(kind);
}

export interface ActivityEvent {
  kind: string;
  occurredAt: Date;
}

export interface MonthStats {
  activeDays: number;
  matureGained: number;
  savedGained: number;
}

/** Stats over `[from, to)`. Weight is ignored on purpose: a capped-out review still means the learner was there. */
export function activityStats(
  events: ReadonlyArray<ActivityEvent>,
  timezone: string,
  from: Date,
  to: Date,
): MonthStats {
  const days = new Set<string>();
  let matureGained = 0;
  let savedGained = 0;
  for (const event of events) {
    const at = event.occurredAt.getTime();
    if (at < from.getTime() || at >= to.getTime() || !isActiveDayKind(event.kind)) continue;
    days.add(localDayKey(timezone, event.occurredAt));
    if (event.kind === "mature") matureGained += 1;
    if (event.kind === "save") savedGained += 1;
  }
  return { activeDays: days.size, matureGained, savedGained };
}

export function isMonthCounted(stats: MonthStats, config: ProgressGoalsConfig): boolean {
  return (
    stats.activeDays >= config.minActiveDays && (stats.matureGained >= 1 || stats.savedGained >= config.minNewWords)
  );
}

/** Garbage or stale timezone strings live on user rows; a month key must not throw. */
export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** "YYYY-MM" in the user's timezone. */
export function monthKey(at: Date, timezone: string): string {
  return localDayKey(timezone, at).slice(0, 7);
}

function parseMonth(month: string): { year: number; month: number } {
  const [year, value] = month.split("-").map(Number);
  return { year: year ?? 1970, month: value ?? 1 };
}

function formatMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string {
  const { year, month: value } = parseMonth(month);
  return formatMonth(year, value - 1);
}

/** Months in `[from, to)`, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  let { year, month } = parseMonth(from);
  for (let key = formatMonth(year, month); key < to; key = formatMonth(year, month)) {
    months.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Half-open `[start, end)` of a local month, as UTC instants. */
export function monthBounds(month: string, timezone: string): { start: Date; end: Date } {
  const { year, month: value } = parseMonth(month);
  return { start: localMidnight(timezone, year, value, 1), end: localMidnight(timezone, year, value + 1, 1) };
}

export interface PlanDays {
  free: number;
  plus: number;
  pro: number;
  trial: number;
}

/** A subscription row as an interval; `end` is when it stopped covering (period end, or cancel time). */
export interface PlanInterval {
  plan: string;
  provider: string;
  start: Date;
  end: Date;
}

type DayCategory = "paid" | "reward" | "trial";

const CATEGORY_RANK: Record<DayCategory, number> = { paid: 3, reward: 2, trial: 1 };

function categoryOf(provider: string): DayCategory {
  if (provider === TRIAL_PROVIDER) return "trial";
  if (provider === REWARD_PROVIDER) return "reward";
  return "paid";
}

function tierRank(plan: string): number {
  if (plan === "pro") return 2;
  if (plan === "plus") return 1;
  return 0;
}

/**
 * Days of each plan inside a local month. A row covers day `d` only from its
 * creation (`start ≤ d < end`, measured at local midnight). On overlap the paid
 * row wins over a reward over a trial; trial days stay `trial`, never Pro.
 */
export function planDaysForMonth(intervals: ReadonlyArray<PlanInterval>, month: string, timezone: string): PlanDays {
  const result: PlanDays = { free: 0, plus: 0, pro: 0, trial: 0 };
  const { year, month: value } = parseMonth(month);
  const { end: monthEnd } = monthBounds(month, timezone);
  for (let day = 1; ; day += 1) {
    const dayStart = localMidnight(timezone, year, value, day);
    if (dayStart.getTime() >= monthEnd.getTime()) break;
    let best: PlanInterval | null = null;
    for (const interval of intervals) {
      if (interval.start.getTime() > dayStart.getTime() || interval.end.getTime() <= dayStart.getTime()) continue;
      if (tierRank(interval.plan) === 0) continue;
      if (
        !best ||
        CATEGORY_RANK[categoryOf(interval.provider)] > CATEGORY_RANK[categoryOf(best.provider)] ||
        (categoryOf(interval.provider) === categoryOf(best.provider) && tierRank(interval.plan) > tierRank(best.plan))
      ) {
        best = interval;
      }
    }
    if (!best) result.free += 1;
    else if (categoryOf(best.provider) === "trial") result.trial += 1;
    else if (best.plan === "pro") result.pro += 1;
    else result.plus += 1;
  }
  return result;
}

/** Plan held for the most days across a cycle. Mostly-free or trial-only learners get Plus; a tie goes to Pro. */
export function longestHeldPlan(months: ReadonlyArray<PlanDays>): "plus" | "pro" {
  let plus = 0;
  let pro = 0;
  for (const days of months) {
    plus += days.plus;
    pro += days.pro;
  }
  return pro > 0 && pro >= plus ? "pro" : "plus";
}

export function milestonesReached(matureCount: number): number[] {
  return PROGRESS_MILESTONES.filter((milestone) => milestone <= matureCount);
}

/** Next target above both the live count and every badge already claimed — a lapsed word never takes a badge back. */
export function nextMilestone(
  matureCount: number,
  claimed: ReadonlyArray<number>,
): { target: number; remaining: number } | null {
  const floor = Math.max(matureCount, ...claimed, 0);
  const target = PROGRESS_MILESTONES.find((milestone) => milestone > floor);
  return target === undefined ? null : { target, remaining: target - matureCount };
}

export function dayTaskState(
  reviewsToday: number,
  config: ProgressGoalsConfig,
): { done: boolean; reviews: number; target: number } {
  return { done: reviewsToday >= config.dayTaskReviews, reviews: reviewsToday, target: config.dayTaskReviews };
}

export function rhythmWeek(
  activeDaysLast7: number,
  config: ProgressGoalsConfig,
): { met: boolean; days: number; target: number } {
  return { met: activeDaysLast7 >= config.rhythmDays, days: activeDaysLast7, target: config.rhythmDays };
}

export type ProgressGoalType = "day" | "week" | "month";

/** The one goal the screen offers: the smallest step not yet taken. */
export function nearestGoal(state: { dayDone: boolean; weekMet: boolean }): ProgressGoalType {
  if (!state.dayDone) return "day";
  if (!state.weekMet) return "week";
  return "month";
}

/** Every completed cycle, so a jump (backfill, missed job) grants each cycle it skipped; claims dedupe the rest. */
export function cyclesToClaim(countedMonths: number, monthsForReward: number): number[] {
  const cycles = Math.floor(countedMonths / monthsForReward);
  return Array.from({ length: cycles }, (_, index) => index + 1);
}

export type GrantAction = "create" | "extend" | "replace_trial" | "defer";

/**
 * How a reward lands given the user's active row. Mock and reward rows are
 * extended because a second active row breaks the unordered active lookup; a
 * trial is replaced, never extended, or the trial's own one-time extension and its
 * ending messages would misfire; a real billing row is not touched until rows can
 * start in the future.
 */
export function grantAction(active: { provider: string } | null): GrantAction {
  if (!active) return "create";
  if (active.provider === "mock" || active.provider === REWARD_PROVIDER) return "extend";
  if (active.provider === TRIAL_PROVIDER) return "replace_trial";
  return "defer";
}
