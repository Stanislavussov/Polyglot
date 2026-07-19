/**
 * Translation budget — the pipeline's only notion of "how much wall clock is
 * left for the user who is waiting synchronously".
 *
 * Before this existed, the post-generation tail (targeted repair, whole-batch
 * retry, semantic judge, judge repair-and-re-judge) could each stack unbounded
 * latency onto a request. A budget lets those phases bound themselves.
 *
 * Design notes:
 * - **Deadline, not duration.** The caller passes an ABSOLUTE deadline stamped
 *   at the true start of the operation it is guarding. Core never re-anchors a
 *   clock of its own, so work the caller did before reaching `translate()`
 *   (e.g. the dictionary-context lookup) cannot silently push the effective
 *   deadline out past the caller's own hard guard.
 * - **Optional by construction.** An absent/unusable deadline yields an
 *   *unbounded* budget whose `remainingMs()` is `undefined` and whose
 *   `allows()` is always `true`, so every existing caller keeps today's exact
 *   behavior. There is no "default budget"; core never invents a deadline.
 * - **Pure.** The clock is injected (defaulting to `Date.now`), so budget
 *   arithmetic is deterministic in tests without fake timers. It is a test seam
 *   only — production callers pass just the deadline.
 * - **NaN-safe.** The deadline is admitted only through
 *   {@link isFinitePositive}. A `NaN`/`Infinity`/`0`/negative deadline degrades
 *   to unbounded rather than to an instant abort — `setTimeout(fn, NaN)` fires
 *   immediately, which is the exact shape of the "timed out after NaNms" total
 *   AI outage.
 */

import { isFinitePositive } from "../../shared/numbers.js";

/**
 * Wall clock (ms) held back for the semantic judge so it can still run after
 * repair has spent the clock (Amendment 3: "the judge never degrades merely
 * because repair spent the clock").
 *
 * 4s: the judge is a single structured-output round-trip. Production translate
 * p50 is ~7s for the whole pipeline (preflight + parallel generation + judge),
 * putting a single AI round-trip around 2–3s, so 4s clears p50 with headroom
 * while staying well under the AI adapter's own ~10s per-request timeout — the
 * judge time-box, not the adapter, stays the binding constraint. Every phase
 * that runs *before* the judge (whole-batch retry, targeted repair, judge
 * repair-and-re-judge) treats this as untouchable.
 */
export const RESERVED_JUDGE_MS = 4_000;

/**
 * Smallest window worth starting the judge in. Below this the round-trip
 * cannot realistically complete, so starting it would only burn the remainder
 * of the user's clock and then fall back anyway. A sub-minimum window is
 * treated exactly like a time-box expiry (including the `needs_review`
 * policy) — no semantic gate was obtained either way.
 */
export const MIN_JUDGE_BUDGET_MS = 1_000;

/** Remaining-time view of a single translate() call. */
export interface TranslationBudget {
  /** The injected clock. Shared so phase timings use the same time source. */
  now(): number;
  /** Milliseconds left before the deadline; `undefined` when unbounded. */
  remainingMs(): number | undefined;
  /**
   * True when more work may start while still leaving `reserveMs` behind.
   * Always true for an unbounded budget.
   */
  allows(reserveMs: number): boolean;
}

/**
 * Build the budget for one translate() call.
 *
 * @param deadlineAt - Absolute wall-clock deadline, on the same time base as
 *   `now`. Anything not finite-and-positive (including `undefined`) produces an
 *   unbounded budget.
 * @param now - Injected clock; defaults to `Date.now`.
 */
export function createTranslationBudget(deadlineAt: unknown, now?: () => number): TranslationBudget {
  const clock = typeof now === "function" ? now : Date.now;
  const deadline = isFinitePositive(deadlineAt) ? deadlineAt : undefined;

  const remainingMs = (): number | undefined => (deadline === undefined ? undefined : deadline - clock());

  return {
    now: clock,
    remainingMs,
    allows(reserveMs: number): boolean {
      const remaining = remainingMs();
      return remaining === undefined || remaining > reserveMs;
    },
  };
}

/**
 * How much wall clock a pre-judge phase may actually SPEND: everything left
 * except the judge's reservation (Amendment 3 — "the judge never degrades merely
 * because repair spent the clock").
 *
 * `undefined` for an unbounded budget (spend freely). A non-positive result
 * means the reservation is already the only thing left, so the phase must not
 * run at all.
 */
export function spendableBeforeJudgeReserve(budget: TranslationBudget): number | undefined {
  const remaining = budget.remainingMs();
  return remaining === undefined ? undefined : remaining - RESERVED_JUDGE_MS;
}

/** Outcome of a time-boxed operation. */
export type TimeBoxed<T> = { timedOut: true } | { timedOut: false; value: T };

/**
 * Race `operation` against `budgetMs`.
 *
 * An absent or unusable `budgetMs` awaits the operation unchanged — byte-for-byte
 * today's behavior, with no timer created at all. On expiry the operation is
 * NOT cancelled (it cannot be); its eventual result is simply ignored, so the
 * caller must be safe to proceed without it.
 */
export async function runWithTimeBox<T>(operation: Promise<T>, budgetMs: number | undefined): Promise<TimeBoxed<T>> {
  if (!isFinitePositive(budgetMs)) {
    return { timedOut: false, value: await operation };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<TimeBoxed<T>>([
      operation.then((value) => ({ timedOut: false, value })),
      new Promise<TimeBoxed<T>>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), budgetMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
