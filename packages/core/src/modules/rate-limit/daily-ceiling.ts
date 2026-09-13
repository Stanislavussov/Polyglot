/**
 * The daily safety ceiling — the one limit no account can be exempt from.
 *
 * Every other limit in the product is a *product* decision: a plan sells a
 * number, and "unlimited" plans (and internal roles) are meant to bypass it.
 * This one is an operational guard on the AI bill, so it deliberately inverts
 * both rules:
 *
 *  - **There is no way to express "no ceiling".** A plan's own value is a
 *    tuning knob, and a missing one falls back to {@link DEFAULT_DAILY_CREDIT_CEILING}
 *    rather than to infinity. That is what stops a newly created plan, or a
 *    catalog row written before this column existed, from quietly reopening the
 *    hole it closes.
 *  - **Internal roles are not exempt.** `admin` and `tester` bypass every plan
 *    limit elsewhere, but a runaway loop on a staff account spends exactly the
 *    same money as one on a subscriber's.
 *
 * It rides on the credit ledger the daily meter already writes, so it counts
 * every paid call type at its own weight and needs no bookkeeping of its own.
 * The number is meant to sit far above any human day: reaching it is evidence of
 * a loop or an abuse attempt, not of an enthusiastic learner, which is why the
 * refusal says so instead of offering an upgrade.
 */

/**
 * Credits per UTC day when a plan names no ceiling of its own.
 *
 * Set from the cost side rather than the usage side, because the two are not
 * symmetric here. A very heavy legitimate day comes to roughly 80 credits by the
 * call weights (some tens of translations, a handful of mentor turns, a video or
 * two), and a newcomer with a week of the top tier to explore might run several
 * times that on their first day — so any bound tight enough to be "accurate"
 * would eventually refuse a real user, which is the one outcome a guard like this
 * must never produce. Meanwhile the thing it defends is cheap: total AI spend has
 * been running in cents per month, so a looping client stopped at this number
 * costs well under a dollar for the day rather than the unbounded bill it would
 * otherwise run up.
 *
 * Hence a number no person reaches and no loop survives. It is deliberately not
 * a measurement — the per-plan admin column exists so it can be moved without a
 * release once there is production telemetry worth calibrating against.
 */
export const DEFAULT_DAILY_CREDIT_CEILING = 1000;

export interface DailyCeilingStatus {
  allowed: boolean;
  /** The ceiling actually applied, after the fallback. */
  ceiling: number;
  usedCredits: number;
  requestedCredits: number;
  remainingCredits: number;
}

/**
 * The ceiling in force for a plan.
 *
 * A non-positive stored value is treated as unset, not as "refuse everything":
 * a zero typed into the admin form would otherwise take the whole bot down for
 * that plan, and an ops guard that can be turned into an outage by one keystroke
 * is worse than the runaway it prevents.
 */
export function resolveDailyCeiling(planCeiling: number | null | undefined): number {
  return typeof planCeiling === "number" && planCeiling > 0 ? planCeiling : DEFAULT_DAILY_CREDIT_CEILING;
}

export function evaluateDailyCeiling(
  usedCredits: number,
  requestedCredits: number,
  planCeiling: number | null | undefined,
): DailyCeilingStatus {
  const ceiling = resolveDailyCeiling(planCeiling);
  return {
    allowed: usedCredits + requestedCredits <= ceiling,
    ceiling,
    usedCredits,
    requestedCredits,
    remainingCredits: Math.max(0, ceiling - usedCredits),
  };
}
