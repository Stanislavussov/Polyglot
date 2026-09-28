import type { PaymentPort } from "@polyglot/core";

/**
 * Mock payment adapter — checkout always succeeds, renewals are always "paid".
 * Lets the full upgrade → activate → renewal flow run end-to-end today.
 * The real provider (Mollie) becomes a drop-in replacement behind PaymentPort.
 */
export const mockPaymentAdapter: PaymentPort = {
  async createCheckout() {
    return { ok: true };
  },

  async verifyRenewal(subscription) {
    const periodEnd = new Date(subscription.currentPeriodEnd);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    return { paid: true, periodEnd };
  },
};

/** Nothing can be bought and nothing is renewed: a row runs out at its period end. */
const closedPaymentAdapter: PaymentPort = {
  async createCheckout() {
    return { ok: false };
  },

  async verifyRenewal() {
    return { paid: false };
  },
};

const ENABLE_VALUES = new Set(["on", "true", "1", "yes"]);

// Opt-in, never opt-out: the mock hands out paid plans for free, so a missing or
// misspelled MOCK_PAYMENTS must leave production closed rather than open.
function isMockPaymentsEnabled(raw: string | undefined): boolean {
  return raw !== undefined && ENABLE_VALUES.has(raw.trim().toLowerCase());
}

/** The checkout a user may buy through — undefined while buying is closed. */
export function purchasePaymentPort(raw = process.env.MOCK_PAYMENTS): PaymentPort | undefined {
  return isMockPaymentsEnabled(raw) ? mockPaymentAdapter : undefined;
}

/** What the renewal sweep asks — closed stops renewing subscriptions the mock granted. */
export function renewalPaymentPort(raw = process.env.MOCK_PAYMENTS): PaymentPort {
  return purchasePaymentPort(raw) ?? closedPaymentAdapter;
}
