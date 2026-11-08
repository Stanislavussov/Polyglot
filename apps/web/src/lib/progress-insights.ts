import type { ProgressMetrics } from "./types";

export type InsightKey =
  | "todayDone"
  | "weekRhythm"
  | "monthCounted"
  | "monthOnPace"
  | "memory"
  | "reviewDue"
  | "todayTodo"
  | "weekTodo"
  | "monthBehind"
  | "newWords"
  | "firstWord";

export interface Insight {
  key: InsightKey;
  params: Record<string, number>;
}

const MAX_ITEMS = 3;

export function monthPace(
  month: { activeDays: number; minActiveDays: number },
  now: Date,
): { expected: number; onPace: boolean } {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expected = Math.floor((month.minActiveDays * now.getDate()) / daysInMonth);
  return { expected, onPace: month.activeDays >= expected };
}

export function progressInsights(metrics: ProgressMetrics, now: Date): { good: Insight[]; improve: Insight[] } {
  if (metrics.words === 0) return { good: [], improve: [{ key: "firstWord", params: {} }] };

  const good: Insight[] = [];
  const improve: Insight[] = [];
  if (metrics.due > 0) improve.push({ key: "reviewDue", params: { count: metrics.due } });

  const ladder = metrics.ladder;
  if (ladder) {
    const { day, week, month } = ladder;
    if (day.done) good.push({ key: "todayDone", params: {} });
    else improve.push({ key: "todayTodo", params: { left: Math.max(day.target - day.reviews, 0) } });

    if (week.met) good.push({ key: "weekRhythm", params: { days: week.days } });
    else improve.push({ key: "weekTodo", params: { left: Math.max(week.target - week.days, 0) } });

    if (month.counted) good.push({ key: "monthCounted", params: {} });
    else if (monthPace(month, now).onPace) good.push({ key: "monthOnPace", params: { days: month.activeDays } });
    else improve.push({ key: "monthBehind", params: { days: month.activeDays, target: month.minActiveDays } });

    // Mirrors the month rule in progress-goals.ts: one word in long memory, or enough saved words.
    if (!month.counted && month.mature === 0 && month.saved < month.minNewWords) {
      improve.push({ key: "newWords", params: { left: month.minNewWords - month.saved } });
    }
  }
  if (metrics.mature > 0) good.push({ key: "memory", params: { count: metrics.mature } });

  return { good: good.slice(0, MAX_ITEMS), improve: improve.slice(0, MAX_ITEMS) };
}
