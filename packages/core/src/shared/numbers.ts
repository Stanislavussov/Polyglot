/**
 * Shared numeric guards.
 *
 * A single source of truth for "is this a usable positive time budget?" so every
 * consumer (AI request timeout, failover split, op-guard clamp) rejects
 * `NaN`/`Infinity`/`0`/negative the same way. A non-finite budget must never
 * reach `setTimeout`, which treats `NaN` as `0` and fires immediately — the root
 * of the "AI request timed out after NaNms" outage.
 */

/** True when `value` is a finite number strictly greater than zero. */
export function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
