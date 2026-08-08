/**
 * Notification eligibility — real-DB integration tests (Task 71 lane).
 *
 * `getUsersForWindow` is mostly SQL: the notification-enabled/active flags, the
 * 14-day abandonment cutoff, and — the reason this file exists — a correlated
 * `NOT EXISTS` that screens out anyone who has translated within `QUIET_DAYS`.
 * A mocked query builder can prove that *a* subquery was constructed; only a
 * migrated Postgres can prove it selects the right people. Getting this wrong
 * fails in the worst possible direction: either the whole cohort stops being
 * notified, or active users get nagged, and both look like "nothing changed"
 * from the unit lane.
 *
 * Every row is scoped to a user from the collision-safe id factory and the
 * assertions filter the (globally-scoped) result down to those ids, so parallel
 * workers cannot invalidate each other and no cleanup is needed between tests.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { notificationRepository, QUIET_DAYS } from "../repositories/notification.repository.js";
import { translationRequests, userLanguageSettings, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A notification-enabled user whose only configured slot is 08:00 UTC. */
async function seedNotifiableUser(): Promise<number> {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({ telegramId: uniqueTelegramId(), onboarded: true, onboardingStep: 4, isActive: true })
    .returning();

  await db.insert(userLanguageSettings).values({
    userId: user!.id,
    interfaceLang: "ru",
    nativeLang: "ru",
    learningLangs: ["de"],
    timezone: "UTC",
    notificationEnabled: true,
    notificationTimes: ["08:00"],
    // Recent enough to stay clear of the 14-day abandonment cutoff, so these
    // tests isolate the quiet-gate rather than accidentally exercising that one.
    lastInteractionAt: new Date(Date.now() - DAY_MS),
  });

  return user!.id;
}

async function seedTranslation(userId: number, daysAgo: number): Promise<void> {
  await getDb()
    .insert(translationRequests)
    .values({
      userId,
      original: "Haus",
      createdAt: new Date(Date.now() - daysAgo * DAY_MS),
    });
}

/** The eligible user ids this run created, in the order the query returned them. */
async function eligibleAmong(ids: number[]): Promise<number[]> {
  const rows = await notificationRepository.getUsersForWindow(8, 0);
  return rows.filter((row) => ids.includes(row.userId)).map((row) => row.userId);
}

describe("notificationRepository.getUsersForWindow (integration)", () => {
  it("notifies a user who has never translated", async () => {
    // The cohort the whole feature exists for: onboarded, never engaged.
    const userId = await seedNotifiableUser();

    expect(await eligibleAmong([userId])).toEqual([userId]);
  });

  it("notifies a user whose last translation is older than the quiet window", async () => {
    const userId = await seedNotifiableUser();
    await seedTranslation(userId, QUIET_DAYS + 2);

    expect(await eligibleAmong([userId])).toEqual([userId]);
  });

  it("does not notify a user who translated today", async () => {
    // Already in the product — a reminder here is noise at best.
    const userId = await seedNotifiableUser();
    await seedTranslation(userId, 0);

    expect(await eligibleAmong([userId])).toEqual([]);
  });

  it("does not notify a user whose most recent translation is inside the quiet window", async () => {
    const userId = await seedNotifiableUser();
    await seedTranslation(userId, QUIET_DAYS - 1);

    expect(await eligibleAmong([userId])).toEqual([]);
  });

  it("judges on the most recent translation, not the oldest", async () => {
    // A long-time user with history who came back yesterday must be excluded;
    // an EXISTS over the wrong row would wrongly re-include them.
    const userId = await seedNotifiableUser();
    await seedTranslation(userId, QUIET_DAYS + 30);
    await seedTranslation(userId, 1);

    expect(await eligibleAmong([userId])).toEqual([]);
  });

  it("screens each user independently rather than excluding the whole batch", async () => {
    const quiet = await seedNotifiableUser();
    const active = await seedNotifiableUser();
    await seedTranslation(active, 0);

    expect(await eligibleAmong([quiet, active])).toEqual([quiet]);
  });

  it("ignores another user's recent translation", async () => {
    const quiet = await seedNotifiableUser();
    const other = await seedNotifiableUser();
    await seedTranslation(other, 0);

    expect(await eligibleAmong([quiet])).toEqual([quiet]);
  });

  it("still excludes a quiet user outside their configured window", async () => {
    // The quiet gate narrows the cohort; it must not widen the schedule.
    const userId = await seedNotifiableUser();

    const rows = await notificationRepository.getUsersForWindow(15, 0);

    expect(rows.map((row) => row.userId)).not.toContain(userId);
  });
});
