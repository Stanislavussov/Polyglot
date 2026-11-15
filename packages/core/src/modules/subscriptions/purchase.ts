import type { PlanLimitConfig } from "../../ports/settings.port.js";
import type { Subscription } from "../../ports/subscription.repository.js";
import type { SubscriptionPlan } from "../../ports/user.repository.js";
import { isTrial } from "./trial.js";

export type PricedPlan = PlanLimitConfig & { priceUsdCents: number };

/** The plans on sale, cheapest first — the one ladder every channel sells. */
export function purchasableLadder(catalog: PlanLimitConfig[]): PricedPlan[] {
  return catalog
    .filter((plan): plan is PricedPlan => plan.isActive && plan.priceUsdCents !== null)
    .sort((a, b) => a.priceUsdCents - b.priceUsdCents);
}

/** What the user pays for now; a trial or an unpriced plan counts as 0. */
export function paidPlanPrice(
  catalog: PlanLimitConfig[],
  currentPlan: SubscriptionPlan,
  active: Pick<Subscription, "provider"> | null,
): number {
  if (active && isTrial(active)) return 0;
  return catalog.find((plan) => plan.name === currentPlan)?.priceUsdCents ?? 0;
}

export type PurchaseDecision =
  | { ok: true; plan: PricedPlan }
  | { ok: false; reason: "not_for_sale" }
  | { ok: false; reason: "downgrade"; keptPlan: string };

/**
 * Whether `target` may be bought now. Buying cancels the running subscription
 * before opening the new period, so the same or a cheaper plan would pay to lose
 * the current one — downgrades belong at period end (tech-req 16 §4.3).
 */
export function decidePurchase(
  catalog: PlanLimitConfig[],
  currentPlan: SubscriptionPlan,
  active: Pick<Subscription, "provider"> | null,
  target: SubscriptionPlan,
): PurchaseDecision {
  const plan = purchasableLadder(catalog).find((candidate) => candidate.name === target);
  if (!plan) return { ok: false, reason: "not_for_sale" };
  if (paidPlanPrice(catalog, currentPlan, active) < plan.priceUsdCents) return { ok: true, plan };
  const kept = catalog.find((candidate) => candidate.name === currentPlan);
  return { ok: false, reason: "downgrade", keptPlan: kept?.label ?? currentPlan };
}
