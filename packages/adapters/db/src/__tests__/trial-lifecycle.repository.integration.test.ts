/**
 * The queries the reverse trial rests on — integration spec (Task 84).
 *
 * Every decision the trial makes is a pure function elsewhere; what cannot be
 * proved anywhere but against a real Postgres is the SQL those decisions are fed:
 *
 * - `findTrialsEndingBetween` selects by period window and by provider, and
 *   deliberately does NOT filter status — the renewal sweep may already have
 *   expired a row the lifecycle sweep still owes a closing message.
 * - `findTrialByUser` is the once-per-account guard, so it must find a spent
 *   trial as readily as a live one, and must never see another user's.
 * - `hasSentFromSource` is what makes each trial message one-off.
 * - `countEventsSince` is the saved-word count the extension is earned with.
 * - the grant writes both of a trial's timestamps from one clock, which is what
 *   makes `hasBeenExtended` an exact comparison rather than a race between two
 *   hosts' clocks.
 *
 * Timestamps are otherwise written by hand here, which is the whole reason this
 * lives at the adapter level: a trial whose period and creation are a realistic
 * week apart cannot be arranged through the ports.
 */
import { grantOnboardingTrial, hasBeenExtended, TRIAL_DAYS } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { momentumRepository } from "../repositories/momentum.repository.js";
import { notificationRepository } from "../repositories/notification.repository.js";
import { subscriptionRepository } from "../repositories/subscription.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { subscriptions } from "../schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each test owns its own synthetic user; no shared fixtures, no cleanup. */
let nextId = 82_000_000 + process.pid * 1000;
const uniqueTelegramId = (): number => ++nextId;

async function createUser(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "trial-sql" });
  return user.id;
}

/**
 * A trial row with hand-set timestamps: created `days` before it ends, so the
 * "has this been extended" arithmetic (`currentPeriodEnd > createdAt + 7d`) sees
 * the same shape production writes.
 */
async function createTrial(userId: number, endsAt: Date, days = 7): Promise<number> {
  const row = await subscriptionRepository.create({
    userId,
    plan: "plus",
    currentPeriodEnd: endsAt,
    provider: "trial",
  });
  await getDb()
    .update(subscriptions)
    .set({ createdAt: new Date(endsAt.getTime() - days * DAY_MS) })
    .where(eq(subscriptions.id, row.id));
  return row.id;
}

describe("trial lifecycle queries (integration)", () => {
  it("finds a trial in the window whatever its status, and nothing outside it", async () => {
    const userId = await createUser();
    // A window this file owns: far enough out that no other test's fresh trial
    // (which ends a week from now) can fall inside it.
    const end = new Date("2028-05-10T00:00:00Z");
    const since = new Date("2028-05-03T00:00:00Z");
    const cutoff = new Date("2028-05-11T00:00:00Z");

    const insideId = await createTrial(userId, end);
    const outsideId = await createTrial(await createUser(), new Date("2028-07-01T00:00:00Z"));

    const found = await subscriptionRepository.findTrialsEndingBetween(since, cutoff);
    expect(found.map((row) => row.id)).toContain(insideId);
    expect(found.map((row) => row.id)).not.toContain(outsideId);

    // Expired by the renewal sweep — still selected, because the closing message
    // is still owed.
    await subscriptionRepository.updateStatus(insideId, "expired");
    const afterExpiry = await subscriptionRepository.findTrialsEndingBetween(since, cutoff);
    expect(afterExpiry.map((row) => row.id)).toContain(insideId);
  });

  it("writes a trial whose period is exactly the trial length from its own creation", async () => {
    const userId = await createUser();

    const grant = await grantOnboardingTrial({ subscriptions: subscriptionRepository, users: userRepository }, userId);

    expect(grant.granted).toBe(true);
    const row = await subscriptionRepository.findTrialByUser(userId);
    // `hasBeenExtended` is the difference between these two timestamps. Left to
    // the database, `created_at` would be `now()` at transaction start — later
    // than the period end the application computed — so the difference would be
    // a few milliseconds short of the trial length, and on a host whose clock
    // sits behind the bot's it would read as "already extended" and kill the
    // earn-more mechanic for everyone, silently. Hence exact equality.
    expect((row?.currentPeriodEnd.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBe(TRIAL_DAYS * DAY_MS);
    expect(hasBeenExtended(row!)).toBe(false);
  });

  it("retires the row when the plan pointer cannot be written", async () => {
    const userId = await createUser();
    const failingUsers = {
      updateSubscriptionPlan: async () => {
        throw new Error("pointer write lost");
      },
    };

    await expect(
      grantOnboardingTrial({ subscriptions: subscriptionRepository, users: failingUsers }, userId),
    ).rejects.toThrow("pointer write lost");

    // Spent (so the gift cannot be handed out twice) but canceled, so the
    // lifecycle sweep never closes a week the user never held.
    const row = await subscriptionRepository.findTrialByUser(userId);
    expect(row?.status).toBe("canceled");
    expect(await userRepository.findById(userId)).toMatchObject({ subscriptionPlan: "free" });
  });

  it("keeps the once-per-account guard on a spent trial, and never crosses users", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    const id = await createTrial(mine, new Date("2028-06-01T00:00:00Z"));

    expect((await subscriptionRepository.findTrialByUser(mine))?.id).toBe(id);
    expect(await subscriptionRepository.findTrialByUser(theirs)).toBeNull();

    await subscriptionRepository.updateStatus(id, "expired");
    expect((await subscriptionRepository.findTrialByUser(mine))?.id).toBe(id);

    // A bought subscription is not a trial, whatever its plan.
    await subscriptionRepository.create({
      userId: theirs,
      plan: "plus",
      currentPeriodEnd: new Date("2028-06-01T00:00:00Z"),
      provider: "mock",
    });
    expect(await subscriptionRepository.findTrialByUser(theirs)).toBeNull();
  });

  it("reports a trial message as sent only for the user and source it was sent under", async () => {
    const userId = await createUser();

    expect(await notificationRepository.hasSentFromSource(userId, "trial_ending")).toBe(false);

    await notificationRepository.recordSentWord(userId, "[trial_ending]", "trial_ending");

    expect(await notificationRepository.hasSentFromSource(userId, "trial_ending")).toBe(true);
    expect(await notificationRepository.hasSentFromSource(userId, "trial_ending_final")).toBe(false);
    expect(await notificationRepository.hasSentFromSource(await createUser(), "trial_ending")).toBe(false);
  });

  it("counts the words saved since the trial began, and only those", async () => {
    const userId = await createUser();
    const trialStart = new Date("2026-09-11T12:00:00Z");

    await momentumRepository.recordEvent({
      userId,
      kind: "save",
      weight: 2,
      occurredAt: new Date("2026-09-10T12:00:00Z"),
      dedupeKey: `trial-sql-before-${userId}`,
    });
    for (let index = 0; index < 3; index += 1) {
      await momentumRepository.recordEvent({
        userId,
        kind: "save",
        weight: 2,
        occurredAt: new Date("2026-09-12T12:00:00Z"),
        dedupeKey: `trial-sql-during-${userId}-${index}`,
      });
    }
    // A different effort kind must not count towards the words saved.
    await momentumRepository.recordEvent({
      userId,
      kind: "translate",
      weight: 1,
      occurredAt: new Date("2026-09-12T12:00:00Z"),
      dedupeKey: `trial-sql-translate-${userId}`,
    });

    expect(await momentumRepository.countEventsSince(userId, "save", trialStart)).toBe(3);
  });
});
