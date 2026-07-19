import { type AIFailover, isFinitePositive, type SettingsPort } from "@polyglot/core";

/**
 * Hardcoded fallback model. `resolveDefaultAIModel` returns it when the admin has
 * set no DB default, and Phase 2 failover uses it as the second model tried after
 * a retriable failure on the primary (admin-configured) model.
 *
 * Cross-family on purpose. The incidents that make a fallback worth having are
 * availability failures — the NaN-budget outage, the `:free` model 429 freeze, and
 * the 2026-07-17 timeout below — and against those a *different provider family*
 * is what actually recovers: if Gemini is degraded, an OpenAI-family model still
 * answers. Same-family was considered and rejected; it only protects
 * malformed-output recovery, which is not the observed failure mode and is already
 * handled by the validator/judge/repair path.
 *
 * This constant previously held `google/gemini-3.1-flash`, a slug OpenRouter
 * rejects as "not a valid model ID" — so every primary timeout hard-failed instead
 * of recovering (Loki, 2026-07-17: primary `google/gemini-3.1-flash-lite` timed out
 * at 10000ms, the failover attempt was rejected in 13ms, `bot_ai_fallback_total
 * {reason="timeout"}=1`). Verified against the live OpenRouter catalog on
 * 2026-07-19: `openai/gpt-5-nano` VALID, `google/gemini-3.1-flash` INVALID,
 * `google/gemini-3.1-flash-lite` (the production primary) VALID.
 *
 * Any change here must name a model in the known-model catalog — see the guard in
 * `ai-model.test.ts`. This constant is shared with the self-healing plan; both must
 * land on the same value.
 */
export const FALLBACK_AI_MODEL = "openai/gpt-5-nano";

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
 */
export function buildAiFailover(budgetMs: number): AIFailover | undefined {
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
  return { fallbackModel: FALLBACK_AI_MODEL, primaryBudgetMs, reservedFallbackMs };
}

export async function resolveDefaultAIModel(
  settings?: Pick<SettingsPort, "getDefaultAIModel" | "getDefaultAIModelForPlan">,
  plan?: string,
): Promise<string> {
  if (!settings) {
    return FALLBACK_AI_MODEL;
  }

  try {
    if (plan) {
      return (await settings.getDefaultAIModelForPlan(plan)) ?? FALLBACK_AI_MODEL;
    }
    return (await settings.getDefaultAIModel()) ?? FALLBACK_AI_MODEL;
  } catch {
    return FALLBACK_AI_MODEL;
  }
}
