/**
 * No ambient time: every entry point takes the instant as an argument, because the
 * backfill replays historical events and must produce the same result live recording
 * did (§3.2–3.4).
 */
import {
  BAND_THRESHOLDS,
  DAILY_CAPS,
  EFFORT_WEIGHTS,
  type EffortKind,
  HALF_LIFE_MS,
  type MomentumBand,
  type MomentumState,
} from "./momentum.types.js";

/** Continuous exponential decay — no day boundary in the formula. */
export function decay(score: number, from: Date, to: Date): number {
  return score * 2 ** (-(to.getTime() - from.getTime()) / HALF_LIFE_MS);
}

/**
 * Credit `weight` at `at`. A late event (`at < scoredAt`) is discounted forward to
 * the existing `scoredAt` instead of rewinding it, which is what makes the operation
 * commutative — and therefore what makes replay and backfill safe (§3.3).
 */
export function applyEffort(state: MomentumState, weight: number, at: Date): MomentumState {
  if (at.getTime() >= state.scoredAt.getTime()) {
    return { score: decay(state.score, state.scoredAt, at) + weight, scoredAt: at };
  }
  return { score: state.score + decay(weight, at, state.scoredAt), scoredAt: state.scoredAt };
}

export function resolveBand(score: number): MomentumBand {
  if (score >= BAND_THRESHOLDS.strong) return "strong";
  if (score >= BAND_THRESHOLDS.steady) return "steady";
  if (score >= BAND_THRESHOLDS.warming) return "warming";
  return "resting";
}

/**
 * The daily cap is applied as *weight*, never as a refused insert (§3.4): the row is
 * always written so the deterministic dedupe key keeps doing its job, it just lands
 * with `weight = 0` once the day's points for that kind are spent.
 */
export function cappedWeight(kind: EffortKind, usedToday: number): number {
  const base = EFFORT_WEIGHTS[kind];
  if (kind === "mature") return base;
  return Math.max(0, Math.min(base, DAILY_CAPS[kind] - usedToday));
}

interface LocalWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * `Intl.DateTimeFormat` rather than `Temporal`: `Temporal.Now` ignores
 * `vi.setSystemTime` (see `packages/adapters/notifications/src/types.ts`), and the
 * ambient `Temporal` declarations are both partial and not on `@polyglot/core`'s
 * tsconfig include path. `Intl` needs no ambient types and takes the instant explicitly.
 */
function readLocalWallClock(timezone: string, at: Date): LocalWallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

/** Timezones reach us from user rows and can be stale or garbage; a cap computation must not throw inside `record()`. */
function safeLocalWallClock(timezone: string, at: Date): LocalWallClock {
  try {
    return readLocalWallClock(timezone, at);
  } catch {
    return readLocalWallClock("UTC", at);
  }
}

function offsetMsAt(timezone: string, instantMs: number): number {
  const local = safeLocalWallClock(timezone, new Date(instantMs));
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - instantMs;
}

/**
 * UTC instant of a local wall-clock time. Two passes because the offset that applies
 * at the target instant is not necessarily the one in force at the guess — on a DST
 * day a single pass lands an hour off.
 */
function instantForLocalWallClock(timezone: string, wallClockUtcMs: number): Date {
  const guess = wallClockUtcMs - offsetMsAt(timezone, wallClockUtcMs);
  return new Date(wallClockUtcMs - offsetMsAt(timezone, guess));
}

/** "YYYY-MM-DD" in the user's timezone — the bucket every daily cap and praise key is keyed by. */
export function localDayKey(timezone: string, at: Date): string {
  const { year, month, day } = safeLocalWallClock(timezone, at);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Half-open [start, end) bounds of the user's local day, as UTC instants. */
export function localDayBounds(timezone: string, at: Date): { start: Date; end: Date } {
  const { year, month, day } = safeLocalWallClock(timezone, at);
  const start = instantForLocalWallClock(timezone, Date.UTC(year, month - 1, day));
  const end = instantForLocalWallClock(timezone, Date.UTC(year, month - 1, day + 1));
  return { start, end };
}

/** Distinct local days carrying real effort — a day of capped-out (weight 0) rows does not count as active. */
export function activeDaysFromEvents(
  events: ReadonlyArray<{ occurredAt: Date; weight: number }>,
  timezone: string,
  since: Date,
): number {
  const days = new Set<string>();
  for (const event of events) {
    if (event.weight > 0 && event.occurredAt.getTime() >= since.getTime()) {
      days.add(localDayKey(timezone, event.occurredAt));
    }
  }
  return days.size;
}
