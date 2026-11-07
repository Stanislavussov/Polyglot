import { type AIFailover, isFinitePositive, type SettingsPort } from "@polyglot/core";

// Moved to core so every channel resolves the model the same way; re-exported so bot imports (and their mocks) stay put.
export { AIModelNotConfiguredError, resolveDefaultAIModel } from "@polyglot/core";

/**
 * Ideal budget (ms) reserved for the fallback attempt in the failover split. With
 * a comfortable request budget (e.g. the default B = 15_000) the fallback gets the
 * full 5_000 and the primary gets the remainder (10_000), both inside the 20 s op
 * guard. For smaller budgets the reservation is scaled down (see
 * {@link buildAiFailover}) so a low admin timeout can't starve the primary.
 */
export const RESERVED_FALLBACK_MS = 5_000;

/**
 * Minimum request budget (ms) at or above which the failover split is enabled.
 * Below this the split is deliberately disabled (returns `undefined`) so the call
 * runs a single unsplit attempt on the admin-chosen primary with the full budget,
 * rather than carving that already-tiny budget into two windows too short for
 * either model to realistically respond. The admin panel allows `requestTimeoutMs`
 * as low as 1_000 ms; without this floor such a value would leave the primary a
 * sub-second window (or, at the old flat 5_000 reservation, disable failover
 * entirely / starve the primary), silently bypassing the chosen primary model.
 */
export const MIN_FAILOVER_BUDGET_MS = 6_000;

/**
 * Builds the failover split for a resolved request budget `B` (already clamped
 * below the op guard).
 *
 * The fallback reservation scales with the budget — `min(RESERVED_FALLBACK_MS,
 * floor(B / 3))` — so the fallback never claims more than ~1/3 of `B` and the
 * primary always keeps at least the larger share (`primaryBudgetMs >=
 * reservedFallbackMs`). Below {@link MIN_FAILOVER_BUDGET_MS} the split is
 * intentionally disabled and `undefined` is returned; the caller then runs a
 * single unsplit attempt on the primary rather than a degraded two-way split.
 *
 * Invariants when a split is returned: `primaryBudgetMs + reservedFallbackMs <= B`
 * and `primaryBudgetMs >= reservedFallbackMs`.
 *
 * `fallbackModel` is the admin-managed model read from the DB via
 * {@link resolveFallbackAIModel}. `null` means no fallback model is flagged in the
 * admin panel, and then there is nothing to fail over TO — the split is disabled
 * and the call runs unsplit on the primary with the whole budget.
 */
export function buildAiFailover(budgetMs: number, fallbackModel: string | null): AIFailover | undefined {
  // No admin-configured fallback model — nothing to split the budget with.
  if (!fallbackModel) {
    return undefined;
  }
  // A non-finite/non-positive budget (NaN/Infinity/0/negative) disables the split:
  // `NaN < MIN` is false, so without this guard NaN would flow into the arithmetic
  // below and yield `{ primaryBudgetMs: NaN, reservedFallbackMs: NaN }`, which
  // `setTimeout` treats as an instant abort. Deliberate floor otherwise: below
  // MIN_FAILOVER_BUDGET_MS the two-way split isn't worthwhile — disable it.
  if (!isFinitePositive(budgetMs) || budgetMs < MIN_FAILOVER_BUDGET_MS) {
    return undefined;
  }
  // Scale the reservation so the fallback takes at most ~1/3 of the budget; this
  // guarantees the primary keeps at least as much as the fallback (2/3 vs 1/3).
  const reservedFallbackMs = Math.min(RESERVED_FALLBACK_MS, Math.floor(budgetMs / 3));
  const primaryBudgetMs = budgetMs - reservedFallbackMs;
  // Defensive invariant guard: with the /3 scaling above this always holds, but
  // encode it explicitly so any future change to the split can't silently starve
  // the primary below the fallback.
  if (primaryBudgetMs < reservedFallbackMs) {
    return undefined;
  }
  return { fallbackModel, primaryBudgetMs, reservedFallbackMs };
}

/**
 * The failover model, read from the admin-managed DB flag (`ai_models.is_fallback`,
 * set via "Set Fallback" in the admin panel) — the only source there is.
 *
 * `null` means the admin has flagged no enabled model, and the caller then runs
 * without a failover split. A settings read that throws also yields `null`: a DB
 * blip must not take down the primary call, and inventing a model id here is what
 * this whole change exists to remove.
 */
export async function resolveFallbackAIModel(
  settings?: Pick<SettingsPort, "getFallbackAIModel">,
): Promise<string | null> {
  if (!settings) {
    return null;
  }

  try {
    return await settings.getFallbackAIModel();
  } catch {
    return null;
  }
}
