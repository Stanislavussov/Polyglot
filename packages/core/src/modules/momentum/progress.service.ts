/**
 * The goal ladder behind `/progress`. Closing months and claiming rewards is the
 * adapter's single transaction; this service decides when to ask for it and turns
 * the ledger plus the live journal into the one view the screen renders.
 */
import { logEvent } from "../../observability/events.js";
import type { CloseAndClaimResult, ProgressRepository, RewardGrant } from "../../ports/progress.repository.js";
import { localDayBounds, localDayKey } from "./momentum.math.js";
import type { MotivationConfig } from "./momentum.types.js";
import {
  activityStats,
  dayTaskState,
  isMonthCounted,
  type MonthStats,
  milestonesReached,
  monthBounds,
  monthKey,
  nearestGoal,
  nextMilestone,
  type ProgressGoalType,
  progressGoalsConfig,
  rhythmWeek,
  safeTimezone,
} from "./progress-goals.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProgressServiceDeps {
  progressRepository: ProgressRepository;
  getMotivationConfig(): Promise<MotivationConfig>;
  getTimezone(userId: number): Promise<string>;
  countMatureWords(userId: number): Promise<number>;
  now?: () => Date;
}

export interface ProgressView {
  countedMonths: number;
  monthsForReward: number;
  /** Counted months inside the current cycle, `0..monthsForReward-1`. */
  cycleMonths: number;
  month: MonthStats & { counted: boolean; minActiveDays: number; minNewWords: number };
  milestone: { target: number; remaining: number } | null;
  day: { done: boolean; reviews: number; target: number };
  week: { met: boolean; days: number; target: number };
  goal: ProgressGoalType;
  /** Granted by this very call — the screen announces each one once. */
  freshRewards: RewardGrant[];
}

export function createProgressService(deps: ProgressServiceDeps) {
  const clock = deps.now ?? (() => new Date());

  function logClose(userId: number, result: CloseAndClaimResult): void {
    for (const month of result.closedMonths) logEvent("progress.month_closed", { userId, month });
    for (const grant of result.granted) {
      logEvent("progress.reward_granted", { userId, cycle: grant.cycle, plan: grant.plan, action: grant.action });
    }
  }

  /** The one place that decides whether a close may grant: only a live close, only while the ladder is visible. */
  async function close(userId: number, now: Date, source: "live" | "backfill") {
    const config = progressGoalsConfig(await deps.getMotivationConfig());
    const result = await deps.progressRepository.closeAndClaim({
      userId,
      now,
      config,
      grant: config.enabled && source === "live",
      source,
    });
    logClose(userId, result);
    return { config, result };
  }

  return {
    /** Closes ended months and claims due rewards; grants only while the ladder is visible. */
    async closeForUser(userId: number, source: "live" | "backfill" = "live", now = clock()) {
      return (await close(userId, now, source)).result;
    },

    /** `null` while the ladder is hidden — the screen then renders exactly what it did before. */
    async getProgressView(userId: number, now = clock()): Promise<ProgressView | null> {
      if (!progressGoalsConfig(await deps.getMotivationConfig()).enabled) return null;
      const { config, result: closed } = await close(userId, now, "live");

      const timezone = safeTimezone(await deps.getTimezone(userId));
      const month = monthBounds(monthKey(now, timezone), timezone);
      const weekStart = localDayBounds(timezone, new Date(now.getTime() - 6 * DAY_MS)).start;
      const from = new Date(Math.min(month.start.getTime(), weekStart.getTime()));
      const [events, mature] = await Promise.all([
        deps.progressRepository.listActivityEvents(userId, from, month.end),
        deps.countMatureWords(userId),
      ]);
      const claimed = await deps.progressRepository.claimMilestones(userId, milestonesReached(mature), now);

      const monthStats = activityStats(events, timezone, month.start, month.end);
      const today = localDayKey(timezone, now);
      const reviewsToday = events.filter(
        (event) => event.kind === "review" && localDayKey(timezone, event.occurredAt) === today,
      ).length;
      const day = dayTaskState(reviewsToday, config);
      const week = rhythmWeek(activityStats(events, timezone, weekStart, month.end).activeDays, config);

      return {
        countedMonths: closed.countedMonths,
        monthsForReward: config.monthsForReward,
        cycleMonths: closed.countedMonths % config.monthsForReward,
        month: {
          ...monthStats,
          counted: isMonthCounted(monthStats, config),
          minActiveDays: config.minActiveDays,
          minNewWords: config.minNewWords,
        },
        milestone: nextMilestone(mature, claimed),
        day,
        week,
        goal: nearestGoal({ dayDone: day.done, weekMet: week.met }),
        freshRewards: closed.granted,
      };
    },
  };
}

export type ProgressService = ReturnType<typeof createProgressService>;
