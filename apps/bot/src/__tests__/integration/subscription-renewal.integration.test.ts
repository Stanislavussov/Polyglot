/**
 * Renewal of a subscription bought through the test checkout, against real Postgres.
 *
 * Spec: once test payments are closed (production), a plan bought through the mock
 * is not renewed. At the end of the period it already has, the row expires and the
 * user drops to Free. While test payments are on (the dev stack), it keeps renewing.
 *
 * The sweep runs through the same `renewalPaymentPort()` the scheduler wiring uses,
 * with the real repositories. The one narrowing: `findExpired` only returns this
 * test's rows, because the real sweep reads every expired row in the shared
 * database and would close out rows that parallel tests arranged for themselves.
 */
import { subscriptionRepository, userRepository } from "@polyglot/adapter-db";
import { createSubscriptionService, type SubscriptionRepository } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { renewalPaymentPort } from "../../payment.js";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";

/** A Plus subscription bought through the mock, whose period ended a minute ago. */
async function arrangeLapsedMockSubscriber() {
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId);
  await userRepository.updateSubscriptionPlan(userId, "plus");
  const row = await subscriptionRepository.create({
    userId,
    plan: "plus",
    currentPeriodEnd: new Date(Date.now() - 60_000),
    provider: "mock",
    externalId: null,
  });
  return { userId, row };
}

function sweepOnly(userId: number): SubscriptionRepository {
  return Object.assign(Object.create(subscriptionRepository) as SubscriptionRepository, {
    findExpired: async (now: Date) =>
      (await subscriptionRepository.findExpired(now)).filter((sub) => sub.userId === userId),
  });
}

describe("renewing a plan bought through the test checkout (integration)", () => {
  it("lets it run out and drops the user to Free once test payments are closed", async () => {
    // Arrange
    const { userId } = await arrangeLapsedMockSubscriber();
    const service = createSubscriptionService({
      payment: renewalPaymentPort(undefined),
      subscriptions: sweepOnly(userId),
      users: userRepository,
    });

    // Act
    const result = await service.processRenewals();

    // Assert — the row is closed out and the plan pointer is back on Free.
    expect(result).toEqual({ renewed: 0, expired: 1 });
    expect(await subscriptionRepository.findActiveByUser(userId)).toBeNull();
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("free");
  });

  it("keeps renewing it while test payments are on", async () => {
    // Arrange
    const { userId, row } = await arrangeLapsedMockSubscriber();
    const service = createSubscriptionService({
      payment: renewalPaymentPort("on"),
      subscriptions: sweepOnly(userId),
      users: userRepository,
    });

    // Act
    const result = await service.processRenewals();

    // Assert — same row, a month further on, and still Plus.
    expect(result).toEqual({ renewed: 1, expired: 0 });
    const active = await subscriptionRepository.findActiveByUser(userId);
    expect(active?.id).toBe(row.id);
    expect(active!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    expect((await userRepository.findById(userId))?.subscriptionPlan).toBe("plus");
  });
});
