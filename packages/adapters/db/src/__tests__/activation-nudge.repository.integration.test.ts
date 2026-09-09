/**
 * D+1 activation-nudge eligibility — real-DB integration tests
 * (Task 71 lane, Task 72 slice 8).
 *
 * `findActivationNudgeCandidates` is almost entirely SQL: two correlated
 * `NOT EXISTS` subqueries, a 24-hour cutoff, and the deliberate exclusion of
 * legacy rows whose `onboarded_at` is NULL. None of that can be proven against a
 * mocked query builder, so it is proven here against a migrated Postgres.
 *
 * Every row is scoped to a user created from the collision-safe id factory, and
 * the assertions filter the (globally-scoped) result set down to those ids — so
 * parallel workers cannot see or invalidate each other's users, and no cleanup
 * is needed between tests.
 */
import { ACTIVATION_NUDGE_SOURCE } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import {
  ACTIVATION_NUDGE_DELAY_MS,
  ACTIVATION_NUDGE_MAX_AGE_MS,
  userRepository,
} from "../repositories/user.repository.js";
import { notificationHistory, translationRequests, userLanguageSettings, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const NOW = new Date("2026-08-02T09:40:00.000Z");
/** Comfortably past the 24 h window. */
const LONG_AGO = new Date(NOW.getTime() - ACTIVATION_NUDGE_DELAY_MS - 60 * 60 * 1000);

/** Creates an onboarded, active user with a language-settings row. */
async function seedOnboardedUser(onboardedAt: Date | null): Promise<number> {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({
      telegramId: uniqueTelegramId(),
      onboarded: true,
      onboardingStep: 4,
      onboardedAt,
      isActive: true,
    })
    .returning();
  await db.insert(userLanguageSettings).values({
    userId: user!.id,
    interfaceLang: "ru",
    nativeLang: "ru",
    learningLangs: ["de"],
  });
  return user!.id;
}

/** The candidate user ids this run created, in the order the query returned them. */
async function candidateIdsAmong(ids: number[]): Promise<number[]> {
  const rows = await userRepository.findActivationNudgeCandidates(NOW);
  return rows.filter((row) => ids.includes(row.userId)).map((row) => row.userId);
}

describe("userRepository.findActivationNudgeCandidates (integration)", () => {
  it("returns only the user who onboarded ≥ 24 h ago, never translated and was never nudged", async () => {
    const db = getDb();

    const eligible = await seedOnboardedUser(LONG_AGO);

    const translated = await seedOnboardedUser(LONG_AGO);
    await db.insert(translationRequests).values({
      userId: translated,
      original: "hallo",
      // After completion — this is exactly the activation the nudge exists to detect.
      createdAt: new Date(LONG_AGO.getTime() + 60 * 1000),
    });

    const alreadyNudged = await seedOnboardedUser(LONG_AGO);
    await db.insert(notificationHistory).values({
      userId: alreadyNudged,
      original: "Backpfeifengesicht",
      source: ACTIVATION_NUDGE_SOURCE,
    });

    expect(await candidateIdsAmong([eligible, translated, alreadyNudged])).toEqual([eligible]);
  });

  it("ignores a translation made before onboarding completed", async () => {
    const db = getDb();
    const userId = await seedOnboardedUser(LONG_AGO);
    await db.insert(translationRequests).values({
      userId,
      original: "pre-onboarding",
      createdAt: new Date(LONG_AGO.getTime() - 60 * 1000),
    });

    expect(await candidateIdsAmong([userId])).toEqual([userId]);
  });

  it("ignores an unrelated notification_history source", async () => {
    const db = getDb();
    const userId = await seedOnboardedUser(LONG_AGO);
    await db.insert(notificationHistory).values({ userId, original: "Haus", source: "srs" });

    expect(await candidateIdsAmong([userId])).toEqual([userId]);
  });

  it("does not select a user before 24 h have elapsed", async () => {
    const justUnder = new Date(NOW.getTime() - ACTIVATION_NUDGE_DELAY_MS + 60 * 1000);
    const userId = await seedOnboardedUser(justUnder);

    expect(await candidateIdsAmong([userId])).toEqual([]);
  });

  it("never selects a legacy row whose onboarded_at is NULL", async () => {
    // Pre-slice-8 completions carry NULL and are not backfilled: their D+1
    // window is unknowable, so they must stay out of the cohort forever.
    const userId = await seedOnboardedUser(null);

    expect(await candidateIdsAmong([userId])).toEqual([]);
  });

  it("does not select a user whose onboarding is older than the window", async () => {
    // Without an upper bound this is not a D+1 nudge: someone who onboarded
    // months ago and forgot the bot would be greeted with "Still curious?".
    const stale = await seedOnboardedUser(new Date(NOW.getTime() - ACTIVATION_NUDGE_MAX_AGE_MS - 60 * 60 * 1000));
    const fresh = await seedOnboardedUser(LONG_AGO);

    expect(await candidateIdsAmong([stale, fresh])).toEqual([fresh]);
  });

  it("tolerates one missed sweep — the window is wider than the daily cadence", async () => {
    // A deploy or a paused cron must not silently skip a whole day's cohort, so
    // yesterday's cohort is still eligible on the following run.
    const skipped = await seedOnboardedUser(new Date(NOW.getTime() - ACTIVATION_NUDGE_DELAY_MS * 2));

    expect(await candidateIdsAmong([skipped])).toEqual([skipped]);
  });

  it("still selects a user who never opted into scheduled notifications", async () => {
    // `notification_enabled` defaults to false and governs the recurring
    // vocabulary reminders users opt *into*. Filtering the nudge on it would
    // exclude nearly every user and reduce this sweep to a no-op, so it is
    // deliberately not consulted — a blocked user is retired by the history row
    // on their first failed send instead.
    const userId = await seedOnboardedUser(LONG_AGO);
    const db = getDb();
    await db
      .update(userLanguageSettings)
      .set({ notificationEnabled: false })
      .where(eq(userLanguageSettings.userId, userId));

    expect(await candidateIdsAmong([userId])).toEqual([userId]);
  });

  it("does not select a deactivated user", async () => {
    const db = getDb();
    const userId = await seedOnboardedUser(LONG_AGO);
    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));

    expect(await candidateIdsAmong([userId])).toEqual([]);
  });

  it("caps one sweep at the requested limit so a backlog can never fan out unbounded", async () => {
    await seedOnboardedUser(LONG_AGO);
    await seedOnboardedUser(LONG_AGO);

    const rows = await userRepository.findActivationNudgeCandidates(NOW, 1);

    expect(rows).toHaveLength(1);
  });

  it("returns everything the send path needs, joined from the settings row", async () => {
    const userId = await seedOnboardedUser(LONG_AGO);

    const row = (await userRepository.findActivationNudgeCandidates(NOW)).find((r) => r.userId === userId);

    expect(row).toMatchObject({ interfaceLang: "ru", nativeLang: "ru", learningLangs: ["de"] });
    expect(row?.telegramId).toBeGreaterThan(0);
  });
});
