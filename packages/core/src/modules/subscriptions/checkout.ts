import { logEvent } from "../../observability/events.js";
import type {
  HostedPaymentProvider,
  Money,
  PaymentPort,
  RenewableSubscription,
  RenewalResult,
} from "../../ports/payment.port.js";
import type { PaymentRepository } from "../../ports/payment.repository.js";
import type { SubscriptionPlan } from "../../ports/user.repository.js";
import { addOneMonth, type GrantDeps, grantPaidPeriod } from "./grant.js";

export interface HostedCheckoutDeps extends GrantDeps {
  provider: HostedPaymentProvider;
  payments: PaymentRepository;
  /** What a plan costs on this channel; null = not for sale. */
  priceOf(plan: SubscriptionPlan): Promise<Money | null>;
  now?: () => Date;
}

export interface StartCheckoutInput {
  userId: number;
  plan: SubscriptionPlan;
  /** Shown on the provider's page and the bank statement. */
  label: string;
  returnUrl: string;
  email?: string;
}

export type StartCheckoutResult = { ok: true; url: string } | { ok: false };

export type SettleOutcome = "granted" | "already" | "pending" | "failed" | "unknown";

function samePrice(a: Money, b: Money): boolean {
  return a.amountMinor === b.amountMinor && a.currency.toUpperCase() === b.currency.toUpperCase();
}

function orderId(userId: number, now: Date): string {
  return `u${userId}-${now.getTime()}`;
}

/**
 * Selling through a redirect-and-notify card gateway, onto the shared ledger.
 * The provider adapter only talks HTTP; every money decision is made here.
 */
export function createHostedCheckoutService(deps: HostedCheckoutDeps) {
  const now = deps.now ?? (() => new Date());
  const provider = deps.provider;

  return {
    provider: provider.name,

    async start(input: StartCheckoutInput): Promise<StartCheckoutResult> {
      const price = await deps.priceOf(input.plan);
      if (!price) return { ok: false };
      const checkout = await provider.createCheckout({
        orderId: orderId(input.userId, now()),
        label: input.label,
        price,
        returnUrl: input.returnUrl,
        recurring: true,
        ...(input.email && { email: input.email }),
      });
      // The price is pinned here, before the customer pays: settle compares the
      // charged amount to this row, and renewals repeat it.
      await deps.payments.create({
        userId: input.userId,
        plan: input.plan,
        provider: provider.name,
        chargeId: checkout.chargeId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        status: "pending",
      });
      return { ok: true, url: checkout.redirectUrl };
    },

    /** Called for every notification and every return to the site; safe to repeat. */
    async settle(chargeId: string): Promise<SettleOutcome> {
      const payment = await deps.payments.findByCharge(provider.name, chargeId);
      if (!payment) return "unknown";
      if (payment.status !== "pending") return payment.status === "paid" ? "already" : "failed";

      const charge = await provider.fetchCharge(chargeId);
      if (charge.status === "pending") return "pending";
      const ordered = { amountMinor: payment.amountMinor, currency: payment.currency };
      if (charge.status === "failed" || (charge.price && !samePrice(charge.price, ordered))) {
        if (charge.status === "paid") {
          logEvent("payment.amount_mismatch", { paymentId: payment.id, provider: provider.name }, "error");
        }
        await deps.payments.markFailed(payment.id);
        return "failed";
      }

      const claimed = await deps.payments.claimPaid(payment.id, now());
      if (!claimed) return "already";
      try {
        const sub = await grantPaidPeriod(
          deps,
          { userId: payment.userId, plan: payment.plan, provider: provider.name, externalId: chargeId },
          now(),
        );
        await deps.payments.attachSubscription(payment.id, sub.id);
      } catch (error) {
        // No cross-repository transaction here: undo the claim so the provider's
        // next notification retries the grant instead of leaving it paid-but-empty.
        await deps.payments.releaseClaim(payment.id);
        throw error;
      }
      logEvent("payment.granted", { paymentId: payment.id, userId: payment.userId, plan: payment.plan });
      return "granted";
    },

    /** The renewal sweep's question for subscriptions this provider sold. */
    async verifyRenewal(sub: RenewableSubscription): Promise<RenewalResult> {
      const last = await deps.payments.findLastPaidForSubscription(sub.id);
      if (!last || !sub.externalId) return { paid: false };
      const price = { amountMinor: last.amountMinor, currency: last.currency };
      const charge = await provider.chargeRenewal(sub.externalId, {
        orderId: orderId(last.userId, now()),
        label: `Polyglot ${sub.plan}`,
        price,
      });
      if (!charge) return { paid: false };
      await deps.payments.create({
        userId: last.userId,
        plan: sub.plan,
        provider: provider.name,
        chargeId: charge.chargeId,
        amountMinor: price.amountMinor,
        currency: price.currency,
        status: charge.status,
        subscriptionId: sub.id,
      });
      if (charge.status !== "paid") return { paid: false };
      return { paid: true, periodEnd: addOneMonth(sub.currentPeriodEnd) };
    },
  };
}

export type HostedCheckoutService = ReturnType<typeof createHostedCheckoutService>;

/**
 * One renewal sweep over every channel: each subscription is renewed by the
 * provider that sold it; anything else (mock, closed) goes to `fallback`.
 */
export function routeRenewalsByProvider(
  routes: Record<string, Pick<PaymentPort, "verifyRenewal">>,
  fallback: PaymentPort,
): PaymentPort {
  return {
    createCheckout: (userId, plan) => fallback.createCheckout(userId, plan),
    verifyRenewal: (sub) => (routes[sub.provider] ?? fallback).verifyRenewal(sub),
  };
}
