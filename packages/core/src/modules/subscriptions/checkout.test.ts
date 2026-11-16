/**
 * @business Hosted checkout — the web sells through a card gateway, the bot through
 * its own channel, and both write the same `payments` + `subscriptions` ledger.
 *
 * Spec:
 * - start: an unpriced plan is refused; otherwise the provider opens a recurring
 *   checkout and a pending payment pins the price the customer saw.
 * - settle(chargeId): only the provider's re-fetched state grants access. Pending
 *   grants nothing; failed marks the payment failed; paid grants one month exactly
 *   once — a duplicate notification is a no-op; a charged amount that differs from
 *   the order grants nothing; a grant that throws releases the claim for a retry.
 * - renewal: charges the saved card at the price last paid (no silent repricing);
 *   paid extends one month from the old period end, anything else lets it run out.
 * - routing: the renewal sweep asks the provider that sold each subscription.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChargeState, HostedPaymentProvider, PaymentPort } from "../../ports/payment.port.js";
import type { CreatePaymentInput, Payment, PaymentRepository } from "../../ports/payment.repository.js";
import type { Subscription, SubscriptionRepository } from "../../ports/subscription.repository.js";
import { createHostedCheckoutService, routeRenewalsByProvider } from "./checkout.js";

const NOW = new Date("2026-11-15T10:00:00Z");

function memoryPayments(): PaymentRepository & { rows: Payment[] } {
  const rows: Payment[] = [];
  return {
    rows,
    async create(input: CreatePaymentInput) {
      const row: Payment = {
        id: rows.length + 1,
        subscriptionId: null,
        createdAt: NOW,
        paidAt: input.status === "paid" ? NOW : null,
        ...input,
      };
      rows.push(row);
      return row;
    },
    async findByCharge(provider, chargeId) {
      return rows.find((r) => r.provider === provider && r.chargeId === chargeId) ?? null;
    },
    async claimPaid(id, paidAt) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "pending") return null;
      Object.assign(row, { status: "paid", paidAt });
      return row;
    },
    async releaseClaim(id) {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, { status: "pending", paidAt: null });
    },
    async markFailed(id) {
      const row = rows.find((r) => r.id === id);
      if (row) row.status = "failed";
    },
    async attachSubscription(id, subscriptionId) {
      const row = rows.find((r) => r.id === id);
      if (row) row.subscriptionId = subscriptionId;
    },
    async findLastPaidForSubscription(subscriptionId) {
      return rows.filter((r) => r.subscriptionId === subscriptionId && r.status === "paid").at(-1) ?? null;
    },
  };
}

function memorySubscriptions(): SubscriptionRepository & { rows: Subscription[] } {
  const rows: Subscription[] = [];
  return {
    rows,
    async create(input) {
      const row: Subscription = {
        id: rows.length + 1,
        userId: input.userId,
        plan: input.plan,
        status: "active",
        provider: input.provider ?? "mock",
        externalId: input.externalId ?? null,
        currentPeriodEnd: input.currentPeriodEnd,
        createdAt: NOW,
        updatedAt: NOW,
      };
      rows.push(row);
      return row;
    },
    async findActiveByUser(userId) {
      return rows.find((r) => r.userId === userId && r.status === "active") ?? null;
    },
    async findTrialByUser() {
      return null;
    },
    async findTrialsEndingBetween() {
      return [];
    },
    async findExpired() {
      return [];
    },
    async extend(id, end) {
      const row = rows.find((r) => r.id === id);
      if (row) row.currentPeriodEnd = end;
    },
    async updateStatus(id, status) {
      const row = rows.find((r) => r.id === id);
      if (row) row.status = status;
    },
  };
}

function fakeProvider(charge: ChargeState = { status: "paid", price: { amountMinor: 500, currency: "EUR" } }) {
  const state = { charge, renewal: { chargeId: "renew-1", status: "paid" as const } as const };
  const provider: HostedPaymentProvider & { state: typeof state } = {
    name: "gateway",
    state,
    createCheckout: vi.fn(async () => ({ chargeId: "ch-1", redirectUrl: "https://pay.example/ch-1" })),
    fetchCharge: vi.fn(async () => state.charge),
    chargeRenewal: vi.fn(async () => state.renewal),
  };
  return provider;
}

function arrange(
  provider = fakeProvider(),
  price: { amountMinor: number; currency: string } | null = {
    amountMinor: 500,
    currency: "EUR",
  },
) {
  const payments = memoryPayments();
  const subscriptions = memorySubscriptions();
  const users = { updateSubscriptionPlan: vi.fn(async () => null) };
  const service = createHostedCheckoutService({
    provider,
    payments,
    subscriptions,
    users,
    priceOf: async () => price,
    now: () => NOW,
  });
  return { service, provider, payments, subscriptions, users };
}

const START = { userId: 7, plan: "plus", label: "Polyglot Plus", returnUrl: "https://learn.test/plan" };

describe("hosted checkout — start", () => {
  it("opens a recurring checkout and pins the shown price on a pending payment", async () => {
    const { service, provider, payments } = arrange();

    const result = await service.start(START);

    expect(result).toEqual({ ok: true, url: "https://pay.example/ch-1" });
    expect(provider.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ recurring: true, price: { amountMinor: 500, currency: "EUR" } }),
    );
    expect(payments.rows).toMatchObject([
      { userId: 7, plan: "plus", provider: "gateway", chargeId: "ch-1", amountMinor: 500, status: "pending" },
    ]);
  });

  it("refuses a plan that has no price, without reaching the provider", async () => {
    const { service, provider } = arrange(fakeProvider(), null);

    expect(await service.start(START)).toEqual({ ok: false });
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });
});

describe("hosted checkout — settle", () => {
  it("grants one month of the bought plan once the provider confirms the charge", async () => {
    const { service, payments, subscriptions, users } = arrange();
    await service.start(START);

    expect(await service.settle("ch-1")).toBe("granted");

    expect(subscriptions.rows).toMatchObject([
      { userId: 7, plan: "plus", status: "active", provider: "gateway", externalId: "ch-1" },
    ]);
    expect(subscriptions.rows[0]?.currentPeriodEnd.toISOString()).toBe("2026-12-15T10:00:00.000Z");
    expect(users.updateSubscriptionPlan).toHaveBeenCalledWith(7, "plus");
    expect(payments.rows[0]).toMatchObject({ status: "paid", subscriptionId: 1 });
  });

  it("never grants twice when the provider repeats the notification", async () => {
    const { service, subscriptions } = arrange();
    await service.start(START);

    await service.settle("ch-1");
    expect(await service.settle("ch-1")).toBe("already");

    expect(subscriptions.rows).toHaveLength(1);
  });

  it("grants nothing while the charge is still pending", async () => {
    const { service, subscriptions } = arrange(fakeProvider({ status: "pending" }));
    await service.start(START);

    expect(await service.settle("ch-1")).toBe("pending");
    expect(subscriptions.rows).toHaveLength(0);
  });

  it("records a declined charge as failed and grants nothing", async () => {
    const { service, payments, subscriptions } = arrange(fakeProvider({ status: "failed" }));
    await service.start(START);

    expect(await service.settle("ch-1")).toBe("failed");
    expect(payments.rows[0]?.status).toBe("failed");
    expect(subscriptions.rows).toHaveLength(0);
  });

  it("grants nothing when the provider charged a different amount than the order", async () => {
    const { service, subscriptions } = arrange(
      fakeProvider({ status: "paid", price: { amountMinor: 1, currency: "EUR" } }),
    );
    await service.start(START);

    expect(await service.settle("ch-1")).toBe("failed");
    expect(subscriptions.rows).toHaveLength(0);
  });

  it("ignores a charge it never opened", async () => {
    const { service } = arrange();
    expect(await service.settle("forged")).toBe("unknown");
  });

  it("releases the claim when the grant fails, so the next notification grants", async () => {
    const { service, subscriptions, payments } = arrange();
    await service.start(START);
    const create = subscriptions.create;
    subscriptions.create = vi.fn(async () => {
      throw new Error("db down");
    });

    await expect(service.settle("ch-1")).rejects.toThrow("db down");
    expect(payments.rows[0]?.status).toBe("pending");

    subscriptions.create = create;
    expect(await service.settle("ch-1")).toBe("granted");
  });
});

describe("hosted checkout — renewal", () => {
  async function granted(provider = fakeProvider()) {
    const ctx = arrange(provider);
    await ctx.service.start(START);
    await ctx.service.settle("ch-1");
    const sub = ctx.subscriptions.rows[0];
    if (!sub) throw new Error("no subscription");
    return { ...ctx, sub };
  }

  it("charges the saved card at the price last paid and extends one month", async () => {
    const { service, provider, payments, sub } = await granted();

    const result = await service.verifyRenewal(sub);

    expect(provider.chargeRenewal).toHaveBeenCalledWith(
      "ch-1",
      expect.objectContaining({ price: { amountMinor: 500, currency: "EUR" } }),
    );
    expect(result).toEqual({ paid: true, periodEnd: new Date("2027-01-15T10:00:00.000Z") });
    expect(payments.rows.at(-1)).toMatchObject({ chargeId: "renew-1", status: "paid", subscriptionId: sub.id });
  });

  it("lets the period run out when the renewal charge is declined", async () => {
    const provider = fakeProvider();
    const { service, payments, sub } = await granted(provider);
    provider.state.renewal = { chargeId: "renew-1", status: "failed" } as never;

    expect(await service.verifyRenewal(sub)).toEqual({ paid: false });
    expect(payments.rows.at(-1)).toMatchObject({ chargeId: "renew-1", status: "failed" });
  });

  it("lets the period run out when the provider has no recurring payments", async () => {
    const provider = fakeProvider();
    const { service, sub } = await granted(provider);
    provider.chargeRenewal = vi.fn(async () => null);

    expect(await service.verifyRenewal(sub)).toEqual({ paid: false });
  });
});

describe("routeRenewalsByProvider", () => {
  const sub = { id: 1, plan: "plus", externalId: "x", currentPeriodEnd: NOW };

  it("asks the provider that sold the subscription", async () => {
    const gateway = { verifyRenewal: vi.fn(async () => ({ paid: true, periodEnd: NOW })) };
    const fallback: PaymentPort = {
      createCheckout: vi.fn(async () => ({ ok: true })),
      verifyRenewal: vi.fn(async () => ({ paid: false })),
    };
    const port = routeRenewalsByProvider({ gateway }, fallback);

    expect(await port.verifyRenewal({ ...sub, provider: "gateway" })).toEqual({ paid: true, periodEnd: NOW });
    expect(await port.verifyRenewal({ ...sub, provider: "mock" })).toEqual({ paid: false });
    expect(fallback.verifyRenewal).toHaveBeenCalledTimes(1);
  });
});
