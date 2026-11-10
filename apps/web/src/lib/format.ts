const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// "in 3 hours" reads better than a clock time, which would need the learner's time zone spelled out.
export function formatReset(resetAt: string | undefined, lang: string, now: number = Date.now()): string {
  if (!resetAt) return "";
  const diff = Date.parse(resetAt) - now;
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Number.isNaN(diff) || diff <= MINUTE_MS) return formatter.format(1, "minute");
  if (diff < HOUR_MS) return formatter.format(Math.ceil(diff / MINUTE_MS), "minute");
  return formatter.format(Math.ceil(diff / HOUR_MS), "hour");
}

const DAY_MS = 24 * HOUR_MS;

// A review date is "due now" once it has passed; otherwise it is shown relative to now, in the largest fitting unit.
export function formatDue(dueAt: string, lang: string, now: number = Date.now()): { due: boolean; time: string } {
  const diff = Date.parse(dueAt) - now;
  if (Number.isNaN(diff) || diff <= 0) return { due: true, time: "" };
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (diff < HOUR_MS) return { due: false, time: formatter.format(Math.max(1, Math.ceil(diff / MINUTE_MS)), "minute") };
  if (diff < DAY_MS) return { due: false, time: formatter.format(Math.ceil(diff / HOUR_MS), "hour") };
  return { due: false, time: formatter.format(Math.ceil(diff / DAY_MS), "day") };
}
