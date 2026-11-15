import type { SubscriptionPlan } from "./user.repository.js";

/**
 * Payment ports — provider-agnostic. Every channel sells through one of these and
 * every sale lands in the same ledger (`payments` + `subscriptions`), so a plan
 * bought on the web and one bought in the bot are the same entitlement.
 *
 * - `PaymentPort` — what the subscription service and the renewal sweep call.
 *   The bot's mock implements it directly; a hosted provider reaches it through
 *   the hosted-checkout service in `modules/subscriptions/checkout.ts`.
 * - `HostedPaymentProvider` — a redirect-and-notify card gateway (the web).
 *   One adapter per provider in `packages/adapters/payments`.
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

/** An amount in the currency's minor unit (cents), ISO 4217 currency code. */
export interface Money {
  amountMinor: number;
  currency: string;
}

export interface HostedChargeRequest {
  /** Our reference for the charge, echoed back by the provider. */
  orderId: string;
  /** Shown to the customer on the checkout page and the bank statement. */
  label: string;
  price: Money;
  email?: string;
}

export interface HostedCheckoutRequest extends HostedChargeRequest {
  /** Where the provider sends the customer back after paying or giving up. */
  returnUrl: string;
  /** Ask the provider to keep the card for the monthly renewal charge. */
  recurring: boolean;
}

export interface HostedCheckout {
  chargeId: string;
  redirectUrl: string;
}

export type ChargeStatus = "pending" | "paid" | "failed";

export interface ChargeState {
  status: ChargeStatus;
  /** What the provider actually charged — compared to the order before granting. */
  price?: Money;
}

export interface HostedPaymentProvider {
  /** Stored in `payments.provider` and `subscriptions.provider`. */
  readonly name: string;
  createCheckout(request: HostedCheckoutRequest): Promise<HostedCheckout>;
  /**
   * The charge's state as the provider holds it. A notification only says
   * "look at charge X"; this re-fetch is the one thing allowed to grant access.
   */
  fetchCharge(chargeId: string): Promise<ChargeState>;
  /**
   * Charge the card saved by `initialChargeId` again. `null` when the provider
   * (or this merchant account) has no recurring payments — the period then just
   * runs out and the customer buys again.
   */
  chargeRenewal(
    initialChargeId: string,
    request: HostedChargeRequest,
  ): Promise<{ chargeId: string; status: ChargeStatus } | null>;
}
