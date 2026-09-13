import { describe, expect, it, vi } from "vitest";
import type { PaymentPort } from "../../ports/payment.port.js";
import type { Subscription, SubscriptionRepository } from "../../ports/subscription.repository.js";
import { addOneMonth, createSubscriptionService } from "./index.js";
import {
  addDays,
  decideTrialAction,
  grantOnboardingTrial,
  hasBeenExtended,
  resolveMeteredWindowStart,
  TRIAL_DAYS,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_WORDS,
  TRIAL_PLAN,
  TRIAL_PROVIDER,
  TRIAL_WARNING_HOURS,
} from "./trial.js";

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
    findTrialByUser: vi.fn(async () => null),
    findTrialsEndingBetween: vi.fn(async () => []),
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

describe("onboarding trial — grant", () => {
  const now = new Date("2026-09-11T12:00:00Z");

  it("opens a Plus period on the trial provider and points the user at it", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo();

    const grant = await grantOnboardingTrial({ subscriptions, users }, 42, now);

    expect(grant).toEqual({
      granted: true,
      plan: TRIAL_PLAN,
      days: TRIAL_DAYS,
      currentPeriodEnd: new Date("2026-09-18T12:00:00Z"),
    });
    // `createdAt` is the grant's own clock, so the period is exactly TRIAL_DAYS
    // long by construction and `hasBeenExtended` cannot read a clock offset
    // between the bot and the database as an extension.
    expect(subscriptions.create).toHaveBeenCalledWith({
      userId: 42,
      plan: TRIAL_PLAN,
      provider: TRIAL_PROVIDER,
      externalId: null,
      createdAt: now,
      currentPeriodEnd: new Date("2026-09-18T12:00:00Z"),
    });
    expect(users.updateSubscriptionPlan).toHaveBeenCalledWith(42, TRIAL_PLAN);
  });

  it("refuses a second trial for the life of the account, whatever became of the first", async () => {
    const spentTrial: Subscription = {
      id: 3,
      userId: 42,
      plan: TRIAL_PLAN,
      status: "expired",
      provider: TRIAL_PROVIDER,
      externalId: null,
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
      createdAt: new Date("2026-07-25T00:00:00Z"),
      updatedAt: new Date(),
    };
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo({ findTrialByUser: vi.fn(async () => spentTrial) });

    const grant = await grantOnboardingTrial({ subscriptions, users }, 42, now);

    expect(grant).toEqual({ granted: false, reason: "already_trialled" });
    expect(subscriptions.create).not.toHaveBeenCalled();
    expect(users.updateSubscriptionPlan).not.toHaveBeenCalled();
  });

  it("leaves a paying subscriber's plan alone", async () => {
    const paid: Subscription = {
      id: 4,
      userId: 42,
      plan: "pro",
      status: "active",
      provider: "mock",
      externalId: null,
      currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo({ findActiveByUser: vi.fn(async () => paid) });

    const grant = await grantOnboardingTrial({ subscriptions, users }, 42, now);

    expect(grant).toEqual({ granted: false, reason: "has_subscription" });
    expect(subscriptions.create).not.toHaveBeenCalled();
    expect(users.updateSubscriptionPlan).not.toHaveBeenCalled();
  });
});

describe("onboarding trial — processRenewals never bills it", () => {
  const trialSub: Subscription = {
    id: 11,
    userId: 42,
    plan: TRIAL_PLAN,
    status: "active",
    provider: TRIAL_PROVIDER,
    externalId: null,
    currentPeriodEnd: new Date("2026-09-18T12:00:00Z"),
    createdAt: new Date("2026-09-11T12:00:00Z"),
    updatedAt: new Date(),
  };

  it("expires the trial and drops the user to free without asking the provider", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo({ findExpired: vi.fn(async () => [trialSub]) });
    // A provider of its own, not the shared one: the whole point of this test is
    // that it is never reached, which a mock other tests have already called
    // cannot show. Like the real adapter it answers `paid: true` to everything,
    // so reaching it would hand the user a free Plus subscription for life.
    const provider: PaymentPort = {
      createCheckout: vi.fn(async () => ({ ok: true })),
      verifyRenewal: vi.fn(async (sub) => ({ paid: true, periodEnd: addOneMonth(sub.currentPeriodEnd) })),
    };
    const service = createSubscriptionService({ payment: provider, subscriptions, users });

    const result = await service.processRenewals(new Date("2026-09-18T13:00:00Z"));

    expect(result).toEqual({ renewed: 0, expired: 1 });
    expect(provider.verifyRenewal).not.toHaveBeenCalled();
    expect(subscriptions.extend).not.toHaveBeenCalled();
    expect(subscriptions.updateStatus).toHaveBeenCalledWith(11, "expired");
    expect(users.updateSubscriptionPlan).toHaveBeenCalledWith(42, "free");
  });

  it("endTrial closes an active row and is a no-op on one already closed", async () => {
    const users = { updateSubscriptionPlan: vi.fn(async () => null) };
    const subscriptions = makeSubscriptionRepo();
    const service = createSubscriptionService({ payment: paidProvider, subscriptions, users });

    await service.endTrial(trialSub);
    expect(subscriptions.updateStatus).toHaveBeenCalledWith(11, "expired");
    expect(users.updateSubscriptionPlan).toHaveBeenCalledWith(42, "free");

    await service.endTrial({ ...trialSub, status: "expired" });
    expect(subscriptions.updateStatus).toHaveBeenCalledTimes(1);
    expect(users.updateSubscriptionPlan).toHaveBeenCalledTimes(1);
  });
});

describe("onboarding trial — decideTrialAction", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const untouched = { warned: false, warnedFinal: false, ended: false };
  const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000);
  const base = { now, extended: false, notified: untouched };

  it("does nothing while the end is beyond the warning window", () => {
    const action = decideTrialAction({
      ...base,
      currentPeriodEnd: hoursFromNow(TRIAL_WARNING_HOURS + 1),
      wordsSaved: 50,
    });

    expect(action).toEqual({ kind: "skip" });
  });

  it("earns the extension for a user who saved enough during the week", () => {
    const endsAt = hoursFromNow(2);
    const action = decideTrialAction({ ...base, currentPeriodEnd: endsAt, wordsSaved: TRIAL_EXTENSION_WORDS });

    expect(action).toEqual({
      kind: "extend",
      newPeriodEnd: new Date(endsAt.getTime() + TRIAL_EXTENSION_DAYS * 24 * 60 * 60 * 1000),
    });
  });

  it("refuses a second extension on the ledger fact alone, however the message went", () => {
    // The regression this guards: while "already extended" was read off the
    // congratulation's history row, a transiently failed send left the extension
    // looking unspent and the next sweep granted another three days — and the
    // next, and the next.
    const endsAt = hoursFromNow(2);
    const action = decideTrialAction({
      ...base,
      currentPeriodEnd: endsAt,
      wordsSaved: TRIAL_EXTENSION_WORDS * 5,
      extended: true,
      notified: untouched,
    });

    expect(action).toEqual({ kind: "warn", endsAt, canEarn: false });
  });

  it("warns as soon as the end is inside the window, a day and a half out", () => {
    // With a daily sweep the first pass that sees a trial is 24-48 h from its
    // end, which is why the window is 48 h and why the message names the end
    // date instead of a count of hours.
    const endsAt = hoursFromNow(41);
    const action = decideTrialAction({ ...base, currentPeriodEnd: endsAt, wordsSaved: 0 });

    expect(action).toEqual({ kind: "warn", endsAt, canEarn: true });
  });

  it("warns a user short of the threshold, and only once", () => {
    const endsAt = hoursFromNow(2);
    const input = { ...base, currentPeriodEnd: endsAt, wordsSaved: TRIAL_EXTENSION_WORDS - 1 };

    expect(decideTrialAction(input)).toEqual({ kind: "warn", endsAt, canEarn: true });
    expect(decideTrialAction({ ...input, notified: { ...untouched, warned: true } })).toEqual({ kind: "skip" });
  });

  it("warns again before the extended end, even for a user warned before earning it", () => {
    // The two warnings are counted separately on purpose: sharing one history
    // row let an extended trial end with no warning at all — the unannounced
    // downgrade the whole design exists to avoid.
    const endsAt = hoursFromNow(2);
    const input = {
      ...base,
      currentPeriodEnd: endsAt,
      wordsSaved: TRIAL_EXTENSION_WORDS,
      extended: true,
      notified: { ...untouched, warned: true },
    };

    expect(decideTrialAction(input)).toEqual({ kind: "warn", endsAt, canEarn: false });
    expect(decideTrialAction({ ...input, notified: { ...input.notified, warnedFinal: true } })).toEqual({
      kind: "skip",
    });
  });

  it("ends a trial whose period has passed, and only once", () => {
    const input = { ...base, currentPeriodEnd: hoursFromNow(-1), wordsSaved: 0 };

    expect(decideTrialAction(input)).toEqual({ kind: "end" });
    expect(decideTrialAction({ ...input, notified: { ...untouched, ended: true } })).toEqual({ kind: "skip" });
  });

  it("ends rather than extends once the period is over, however engaged the user was", () => {
    const action = decideTrialAction({
      ...base,
      currentPeriodEnd: hoursFromNow(-1),
      wordsSaved: TRIAL_EXTENSION_WORDS * 3,
    });

    expect(action).toEqual({ kind: "end" });
  });
});

describe("onboarding trial — hasBeenExtended", () => {
  const createdAt = new Date("2026-09-11T12:00:00Z");

  it("reads the granted extension off the period the row carries", () => {
    expect(hasBeenExtended({ createdAt, currentPeriodEnd: addDays(createdAt, TRIAL_DAYS) })).toBe(false);
    expect(
      hasBeenExtended({ createdAt, currentPeriodEnd: addDays(createdAt, TRIAL_DAYS + TRIAL_EXTENSION_DAYS) }),
    ).toBe(true);
  });
});

describe("onboarding trial — the metered window after a downgrade", () => {
  const monthStart = new Date("2026-09-01T00:00:00Z");

  it("starts the free month where the trial ended, not where the month did", () => {
    // Otherwise the unmetered week is billed to the free plan and the first
    // translation after the downgrade is refused.
    const trialEnd = new Date("2026-09-08T12:00:00Z");

    expect(resolveMeteredWindowStart(monthStart, trialEnd)).toEqual(trialEnd);
  });

  it("keeps the calendar month for a trial that ended before it", () => {
    expect(resolveMeteredWindowStart(monthStart, new Date("2026-08-20T00:00:00Z"))).toEqual(monthStart);
  });

  it("keeps the calendar month for an account that never had a trial", () => {
    expect(resolveMeteredWindowStart(monthStart, null)).toEqual(monthStart);
    expect(resolveMeteredWindowStart(monthStart, undefined)).toEqual(monthStart);
  });
});
