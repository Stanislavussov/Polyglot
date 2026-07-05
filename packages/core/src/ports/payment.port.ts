import type { SubscriptionPlan } from "./user.repository.js";

/**
 * Payment Port — provider-agnostic subscription payments.
 *
 * Now backed by a mock adapter (checkout always succeeds, renewal always paid).
 * The real target is Mollie; swapping providers is only a new adapter behind
 * this interface. Supports both a pull path (`verifyRenewal`, used by the cron
 * and card PSPs) — a push path (webhook ingest) can be added later for Stars.
 */

export interface CheckoutResult {
  ok: boolean;
  /** Hosted checkout URL to send the user to (absent for the mock). */
  url?: string;
  /** Provider-side subscription/payment id, stored on the local subscription row. */
  externalId?: string;
}

export interface RenewalResult {
  paid: boolean;
  /** New period end when the renewal was paid. */
  periodEnd?: Date;
}

/** Minimal subscription shape the provider needs to verify a renewal. */
export interface RenewableSubscription {
  id: number;
  plan: SubscriptionPlan;
  provider: string;
  externalId: string | null;
  currentPeriodEnd: Date;
}

export interface PaymentPort {
  createCheckout(userId: number, plan: SubscriptionPlan): Promise<CheckoutResult>;
  verifyRenewal(subscription: RenewableSubscription): Promise<RenewalResult>;
}
