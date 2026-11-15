import type { PaymentPort } from "../../ports/payment.port.js";
import type { Subscription, SubscriptionRepository } from "../../ports/subscription.repository.js";
import type { SubscriptionPlan } from "../../ports/user.repository.js";
import { addOneMonth, grantPaidPeriod, type SubscriptionUserUpdater } from "./grant.js";
import { REWARD_PROVIDER, TRIAL_PROVIDER } from "./trial.js";

export { addOneMonth, grantPaidPeriod, type SubscriptionUserUpdater } from "./grant.js";

export interface SubscriptionServiceDeps {
  payment: PaymentPort;
  subscriptions: SubscriptionRepository;
  users: SubscriptionUserUpdater;
}

export interface ActivationResult {
  ok: boolean;
  url?: string;
  currentPeriodEnd?: Date;
}

export interface RenewalSweepResult {
  renewed: number;
  expired: number;
}

/**
 * Close a period out: expire the row, and point the user at whatever active
 * subscription still covers them (a concurrent upgrade, say), else free — leaving
 * the pointer alone would keep serving the expired row's plan.
 */
async function expireAndDowngrade(
  deps: Pick<SubscriptionServiceDeps, "subscriptions" | "users">,
  sub: Subscription,
): Promise<void> {
  await deps.subscriptions.updateStatus(sub.id, "expired");
  const remaining = await deps.subscriptions.findActiveByUser(sub.userId);
  await deps.users.updateSubscriptionPlan(sub.userId, remaining ? remaining.plan : "free");
}

/**
 * Subscription lifecycle service — provider-agnostic orchestration over the
 * PaymentPort, the subscriptions ledger, and the user's plan pointer.
 */
export function createSubscriptionService(deps: SubscriptionServiceDeps) {
  return {
    /** Run checkout and, on success, upgrade the user's plan + open a subscription period. */
    async activate(userId: number, plan: SubscriptionPlan, now = new Date()): Promise<ActivationResult> {
      const checkout = await deps.payment.createCheckout(userId, plan);
      if (!checkout.ok) {
        return { ok: false, url: checkout.url };
      }
      const { currentPeriodEnd } = await grantPaidPeriod(
        deps,
        { userId, plan, provider: "mock", externalId: checkout.externalId ?? null },
        now,
      );
      return { ok: true, currentPeriodEnd };
    },

    /**
     * Sweep expired subscriptions: verify renewal with the provider; extend on
     * payment, otherwise expire the row and downgrade the user to free.
     */
    async processRenewals(now = new Date()): Promise<RenewalSweepResult> {
      const due = await deps.subscriptions.findExpired(now);
      let renewed = 0;
      let expired = 0;
      for (const sub of due) {
        // A trial was never billed, so there is nothing to verify and no
        // provider to ask. The mock adapter answers `paid: true` to every
        // query — routing a trial through it would silently turn the
        // onboarding gift into a free Plus subscription for life.
        // A progress reward was never billed either, and the same `paid: true` would renew it forever.
        if (sub.provider === TRIAL_PROVIDER || sub.provider === REWARD_PROVIDER) {
          await expireAndDowngrade(deps, sub);
          expired += 1;
          continue;
        }
        const result = await deps.payment.verifyRenewal({
          id: sub.id,
          plan: sub.plan,
          provider: sub.provider,
          externalId: sub.externalId,
          currentPeriodEnd: sub.currentPeriodEnd,
        });
        if (result.paid) {
          await deps.subscriptions.extend(sub.id, result.periodEnd ?? addOneMonth(now));
          renewed += 1;
        } else {
          await expireAndDowngrade(deps, sub);
          expired += 1;
        }
      }
      return { renewed, expired };
    },

    /**
     * Close out one trial row the caller already holds. The trial-lifecycle
     * sweep owns the closing message, and it must not depend on whether the
     * nightly renewal sweep happened to reach the row first — so both paths end
     * a trial the same way, and doing it twice is harmless.
     */
    async endTrial(sub: Subscription): Promise<void> {
      if (sub.status === "active") {
        await expireAndDowngrade(deps, sub);
      }
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
