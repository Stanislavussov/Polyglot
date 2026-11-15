import type { ChargeStatus } from "./payment.port.js";
import type { SubscriptionPlan } from "./user.repository.js";

/** One charge, whatever channel sold it. `(provider, chargeId)` is unique. */
export interface Payment {
  id: number;
  userId: number;
  plan: SubscriptionPlan;
  provider: string;
  chargeId: string;
  amountMinor: number;
  currency: string;
  status: ChargeStatus;
  /** The period this charge paid for; null until it is granted. */
  subscriptionId: number | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface CreatePaymentInput {
  userId: number;
  plan: SubscriptionPlan;
  provider: string;
  chargeId: string;
  amountMinor: number;
  currency: string;
  status: ChargeStatus;
  subscriptionId?: number | null;
}

export interface PaymentRepository {
  create(input: CreatePaymentInput): Promise<Payment>;
  findByCharge(provider: string, chargeId: string): Promise<Payment | null>;
  /**
   * `pending → paid`, exactly once: returns the row only to the caller that made
   * the transition, `null` to every later one. The guard against a duplicate
   * notification granting twice.
   */
  claimPaid(id: number, paidAt: Date): Promise<Payment | null>;
  /** Undo a claim whose grant failed, so the next notification retries it. */
  releaseClaim(id: number): Promise<void>;
  markFailed(id: number): Promise<void>;
  attachSubscription(id: number, subscriptionId: number): Promise<void>;
  /** The newest paid charge for a subscription — the price a renewal repeats. */
  findLastPaidForSubscription(subscriptionId: number): Promise<Payment | null>;
}
