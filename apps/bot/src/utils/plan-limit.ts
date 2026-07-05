import type { PlanLimitConfig, SettingsPort, SubscriptionPlan } from "@polyglot/core";

/**
 * Resolves a user's plan limit from the single DB-backed settings source
 * (Fable T21/A7). `SettingsPort.getPlanLimit` returns `null` only when the plan
 * name is absent from both the DB and the service's fallback table; in that case
 * we fall back to the configured default plan (never the removed hardcoded
 * `PLAN_LIMITS`). `getPlanLimits()` is guaranteed non-empty by the settings
 * service, so a default always exists.
 */
export async function resolvePlanLimit(settings: SettingsPort, plan: SubscriptionPlan): Promise<PlanLimitConfig> {
  const direct = await settings.getPlanLimit(plan);
  if (direct) return direct;

  const all = await settings.getPlanLimits();
  const fallback = all.find((p) => p.isDefault) ?? all[0];
  if (!fallback) {
    throw new Error("No plan limits configured (settings source returned an empty plan table)");
  }
  return fallback;
}
