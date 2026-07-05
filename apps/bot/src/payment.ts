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
