import type { PaymentPort } from "../../ports/payment.port.js";
import type { SubscriptionRepository } from "../../ports/subscription.repository.js";
import type { SubscriptionPlan } from "../../ports/user.repository.js";

/** Just the user-mutation the subscription lifecycle needs (kept narrow on purpose). */
export interface SubscriptionUserUpdater {
  updateSubscriptionPlan(userId: number, plan: SubscriptionPlan): Promise<unknown>;
}

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

/** Add one calendar month (UTC). Date normalizes overflow (e.g. Jan 31 → Mar 3). */
export function addOneMonth(from: Date): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
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
      // Supersede any existing active subscription (repeat buy, or Plus→Pro upgrade)
      // so a user never accumulates multiple concurrent active rows.
      const existing = await deps.subscriptions.findActiveByUser(userId);
      if (existing) {
        await deps.subscriptions.updateStatus(existing.id, "canceled");
      }
      const currentPeriodEnd = addOneMonth(now);
      await deps.users.updateSubscriptionPlan(userId, plan);
      await deps.subscriptions.create({
        userId,
        plan,
        currentPeriodEnd,
        provider: "mock",
        externalId: checkout.externalId ?? null,
      });
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
          await deps.subscriptions.updateStatus(sub.id, "expired");
          // Only downgrade if no other active subscription remains (e.g. a
          // concurrent upgrade) — don't clobber a still-valid plan pointer.
          const remaining = await deps.subscriptions.findActiveByUser(sub.userId);
          if (!remaining) {
            await deps.users.updateSubscriptionPlan(sub.userId, "free");
          }
          expired += 1;
        }
      }
      return { renewed, expired };
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
