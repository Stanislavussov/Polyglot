import { describe, expect, it, vi } from "vitest";
import type { PaymentPort } from "../../ports/payment.port.js";
import type { Subscription, SubscriptionRepository } from "../../ports/subscription.repository.js";
import { addOneMonth, createSubscriptionService } from "./index.js";

function makeSubscriptionRepo(overrides: Partial<SubscriptionRepository> = {}): SubscriptionRepository {
  return {
    create: vi.fn(async (input) => ({
      id: 1,
      userId: input.userId,
      plan: input.plan,
      status: "active" as const,
      provider: input.provider ?? "mock",
      externalId: input.externalId ?? null,
      currentPeriodEnd: input.currentPeriodEnd,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findActiveByUser: vi.fn(async () => null),
    findExpired: vi.fn(async () => []),
    extend: vi.fn(async () => {}),
    updateStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

const paidProvider: PaymentPort = {
  createCheckout: vi.fn(async () => ({ ok: true })),
  verifyRenewal: vi.fn(async (sub) => ({ paid: true, periodEnd: addOneMonth(sub.currentPeriodEnd) })),
};

describe("subscription service — activate", () => {
  it("upgrades the plan pointer and opens a one-month subscription on successful checkout", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo();
    const service = createSubscriptionService({ payment: paidProvider, subscriptions, users });

    const now = new Date("2026-07-04T00:00:00Z");
    const result = await service.activate(42, "plus", now);

    expect(result.ok).toBe(true);
    expect(result.currentPeriodEnd?.toISOString()).toBe("2026-08-04T00:00:00.000Z");
    expect(users.updateSubscriptionPlan).toHaveBeenCalledWith(42, "plus");
    expect(subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, plan: "plus", provider: "mock" }),
    );
  });

  it("supersedes an existing active subscription instead of stacking a second one", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const existing: Subscription = {
      id: 99,
      userId: 42,
      plan: "plus",
      status: "active",
      provider: "mock",
      externalId: null,
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const subscriptions = makeSubscriptionRepo({ findActiveByUser: vi.fn(async () => existing) });
    const service = createSubscriptionService({ payment: paidProvider, subscriptions, users });

    await service.activate(42, "pro");

    expect(subscriptions.updateStatus).toHaveBeenCalledWith(99, "canceled");
    expect(subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, plan: "pro" }));
  });

  it("does not upgrade when checkout fails", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo();
    const failingProvider: PaymentPort = {
      createCheckout: vi.fn(async () => ({ ok: false })),
      verifyRenewal: vi.fn(async () => ({ paid: false })),
    };
    const service = createSubscriptionService({ payment: failingProvider, subscriptions, users });

    const result = await service.activate(42, "plus");

    expect(result.ok).toBe(false);
    expect(users.updateSubscriptionPlan).not.toHaveBeenCalled();
    expect(subscriptions.create).not.toHaveBeenCalled();
  });
});

describe("subscription service — processRenewals", () => {
  const expiredSub: Subscription = {
    id: 7,
    userId: 42,
    plan: "plus",
    status: "active",
    provider: "mock",
    externalId: null,
    currentPeriodEnd: new Date("2026-07-01T00:00:00Z"),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("extends the period when the provider reports a paid renewal", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo({ findExpired: vi.fn(async () => [expiredSub]) });
    const service = createSubscriptionService({ payment: paidProvider, subscriptions, users });

    const result = await service.processRenewals(new Date("2026-07-02T00:00:00Z"));

    expect(result).toEqual({ renewed: 1, expired: 0 });
    expect(subscriptions.extend).toHaveBeenCalledWith(7, addOneMonth(expiredSub.currentPeriodEnd));
    expect(users.updateSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("expires the row and downgrades the user to free when renewal is unpaid", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo({ findExpired: vi.fn(async () => [expiredSub]) });
    const unpaidProvider: PaymentPort = {
      createCheckout: vi.fn(async () => ({ ok: true })),
      verifyRenewal: vi.fn(async () => ({ paid: false })),
    };
    const service = createSubscriptionService({ payment: unpaidProvider, subscriptions, users });

    const result = await service.processRenewals();

    expect(result).toEqual({ renewed: 0, expired: 1 });
    expect(subscriptions.updateStatus).toHaveBeenCalledWith(7, "expired");
    expect(users.updateSubscriptionPlan).toHaveBeenCalledWith(42, "free");
  });

  it("expires the row but keeps the plan when another active subscription remains", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const stillActive: Subscription = { ...expiredSub, id: 8, currentPeriodEnd: new Date("2026-12-01T00:00:00Z") };
    const subscriptions = makeSubscriptionRepo({
      findExpired: vi.fn(async () => [expiredSub]),
      findActiveByUser: vi.fn(async () => stillActive),
    });
    const unpaidProvider: PaymentPort = {
      createCheckout: vi.fn(async () => ({ ok: true })),
      verifyRenewal: vi.fn(async () => ({ paid: false })),
    };
    const service = createSubscriptionService({ payment: unpaidProvider, subscriptions, users });

    const result = await service.processRenewals();

    expect(result).toEqual({ renewed: 0, expired: 1 });
    expect(subscriptions.updateStatus).toHaveBeenCalledWith(7, "expired");
    expect(users.updateSubscriptionPlan).not.toHaveBeenCalled();
  });
});
