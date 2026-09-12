/**
 * Notification eligibility — real-DB integration tests (Task 71 lane).
 *
 * `getUsersForWindow` decides who receives a scheduled notification, and it is
 * mostly SQL: the opt-in flag, the active flag, the 14-day reachability ceiling,
 * and then a timezone-aware slot match applied in JS over the returned rows. A
 * mocked query builder can prove that *a* predicate was constructed; only a
 * migrated Postgres can prove it selects the right people. Getting this wrong
 * fails in the worst possible direction — the whole cohort silently stops being
 * notified while `/settings` keeps rendering "Notifications: on" — and it looks
 * like "nothing changed" from the unit lane.
 *
 * The contract this file pins: **a scheduled notification is content the user
 * subscribed to, not a nudge.** Whether the user is engaged is irrelevant; the
 * one case below that says so out loud ("notifies a subscriber who translated
 * today") is a regression guard for the `QUIET_DAYS` gate that once suppressed
 * exactly the people who had asked to be mailed.
 *
 * **Slot convention — this lane owns 08:00 local.** The bot delivery lane
 * (`apps/bot/src/__tests__/integration/notification-delivery.integration.test.ts`)
 * owns `DELIVERY_TEST_SLOT_UTC` = 13:00 UTC and must never be given 08:00: rows
 * seeded here are never cleaned up (deliberately — see below) and
 * `checkAndSend` scans the table globally, so overlapping slots would let the two
 * lanes deliver into each other's assertions.
 *
 * Every row is scoped to a user from the collision-safe id factory and the
 * assertions filter the (globally-scoped) result down to those ids, so parallel
 * workers cannot invalidate each other and no cleanup is needed between tests.
 */
import { DEFAULT_NOTIFICATION_TIME, parseNotificationMinutes, REENGAGEMENT_INTERVAL_DAYS } from "@polyglot/core";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { notificationRepository } from "../repositories/notification.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { translationRequests, userLanguageSettings, users } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface SeedOptions {
  notificationEnabled?: boolean;
  notificationTimes?: string[];
  timezone?: string;
  isActive?: boolean;
  /** `null` seeds a NULL column — a user who has never interacted. */
  lastInteractionAt?: Date | null;
  /** `null` seeds a NULL column — no ping yet in the current lapse episode. */
  lastReengagementAt?: Date | null;
  reengagementCount?: number;
}

/** A notification-enabled user whose only configured slot is 08:00 local. */
async function seedNotifiableUser(options: SeedOptions = {}): Promise<number> {
  const {
    notificationEnabled = true,
    notificationTimes = ["08:00"],
    timezone = "UTC",
    isActive = true,
    // Recent enough to stay clear of the 14-day reachability ceiling, so these
    // tests isolate the property under test rather than accidentally exercising
    // abandonment.
    lastInteractionAt = new Date(Date.now() - DAY_MS),
    lastReengagementAt = null,
    reengagementCount = 0,
  } = options;

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
    timezone,
    notificationEnabled,
    notificationTimes,
    isActive,
    lastInteractionAt,
    lastReengagementAt,
    reengagementCount,
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
async function eligibleAmong(ids: number[], hour = 8, minute = 0): Promise<number[]> {
  const rows = await notificationRepository.getUsersForWindow(hour, minute);
  return rows.filter((row) => ids.includes(row.userId)).map((row) => row.userId);
}

describe("notificationRepository.getUsersForWindow (integration)", () => {
  it("notifies a subscriber when their configured slot matches the window", async () => {
    const userId = await seedNotifiableUser();

    expect(await eligibleAmong([userId])).toEqual([userId]);
  });

  it("notifies a subscriber who translated today", async () => {
    // The regression guard for the removed QUIET_DAYS gate. A scheduled
    // notification is a subscription: the user opened the 48-slot grid and picked
    // this time. Suppressing it because they are already engaged is like skipping
    // someone's alarm because they woke up yesterday — and because
    // `notification_enabled` is only ever set by that explicit toggle, the gate
    // could only ever silence people who had asked to be mailed.
    const userId = await seedNotifiableUser();
    await seedTranslation(userId, 0);

    expect(await eligibleAmong([userId])).toEqual([userId]);
  });

  it("notifies a daily user every day, not once and then never", async () => {
    // Several translations across the last few days — the exact usage pattern the
    // gate turned into permanent silence.
    const userId = await seedNotifiableUser();
    await seedTranslation(userId, 0);
    await seedTranslation(userId, 1);
    await seedTranslation(userId, 2);

    expect(await eligibleAmong([userId])).toEqual([userId]);
  });

  it("notifies a subscriber who has never interacted (NULL last_interaction_at)", async () => {
    const userId = await seedNotifiableUser({ lastInteractionAt: null });

    expect(await eligibleAmong([userId])).toEqual([userId]);
  });

  it("does not notify a user who has not opted in", async () => {
    const userId = await seedNotifiableUser({ notificationEnabled: false });

    expect(await eligibleAmong([userId])).toEqual([]);
  });

  it("does not notify a deactivated user", async () => {
    const userId = await seedNotifiableUser({ isActive: false });

    expect(await eligibleAmong([userId])).toEqual([]);
  });

  it("does not notify a user abandoned for longer than the 14-day ceiling", async () => {
    // INACTIVITY_DAYS is a reachability ceiling — stop mailing the abandoned —
    // not engagement targeting.
    const userId = await seedNotifiableUser({ lastInteractionAt: new Date(Date.now() - 20 * DAY_MS) });

    expect(await eligibleAmong([userId])).toEqual([]);
  });

  it("does not notify outside the configured window", async () => {
    const userId = await seedNotifiableUser();

    expect(await eligibleAmong([userId], 15, 0)).toEqual([]);
  });

  it("notifies a user who has never picked a time, in the product-default window", async () => {
    // An empty list means "never opened Settings", not "wants silence". Since
    // notifications ship switched ON, treating empty as "never send" would make
    // that default inert for everyone who has not gone looking for the toggle —
    // which was almost the entire user base.
    const userId = await seedNotifiableUser({ notificationTimes: [] });
    const defaultMinutes = parseNotificationMinutes(DEFAULT_NOTIFICATION_TIME);

    expect(await eligibleAmong([userId], Math.floor(defaultMinutes / 60), defaultMinutes % 60)).toEqual([userId]);
  });

  it("does not notify a user who has never picked a time outside that window", async () => {
    // The resolution is a default hour, not "always eligible".
    const userId = await seedNotifiableUser({ notificationTimes: [] });
    const defaultHour = Math.floor(parseNotificationMinutes(DEFAULT_NOTIFICATION_TIME) / 60);

    expect(await eligibleAmong([userId], (defaultHour + 5) % 24, 0)).toEqual([]);
  });

  it("ships a brand-new subscriber switched on, without anyone touching Settings", async () => {
    // Pins the schema default itself: the row is inserted with no notification
    // columns at all, exactly as onboarding's `updateSettings` upsert leaves it.
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
    });
    const defaultMinutes = parseNotificationMinutes(DEFAULT_NOTIFICATION_TIME);

    expect(await eligibleAmong([user!.id], Math.floor(defaultMinutes / 60), defaultMinutes % 60)).toEqual([user!.id]);
  });

  it("screens each user independently", async () => {
    const subscriber = await seedNotifiableUser();
    const optedOut = await seedNotifiableUser({ notificationEnabled: false });

    expect(await eligibleAmong([subscriber, optedOut])).toEqual([subscriber]);
  });

  it("matches any of several configured slots", async () => {
    const userId = await seedNotifiableUser({ notificationTimes: ["08:00", "21:30"] });

    expect(await eligibleAmong([userId], 21, 30)).toEqual([userId]);
  });

  // Offset resolution is asserted here, against `getUsersForWindow(h, m)`
  // directly, and NOT through the scheduler batch: the batch's injected clock
  // supplies only `{hour, minute}`, while `getLocalMinutes` deliberately resolves
  // the offset against *today's* date so DST is correct. Only this lane can pin
  // offset behaviour deterministically.
  it("resolves a sub-hour timezone offset (+05:45)", async () => {
    // Asia/Kathmandu is UTC+05:45, so a local 08:00 slot falls in the 02:15 UTC window.
    const userId = await seedNotifiableUser({ timezone: "Asia/Kathmandu" });

    expect(await eligibleAmong([userId], 2, 15)).toEqual([userId]);
    expect(await eligibleAmong([userId], 8, 0)).toEqual([]);
  });

  it("excludes a user whose timezone cannot be parsed", async () => {
    // getLocalMinutes returns -1 and the row is dropped. The exclusion is
    // otherwise invisible, which is why getUsersForWindow counts and warns.
    const userId = await seedNotifiableUser({ timezone: "Not/AZone" });

    expect(await eligibleAmong([userId])).toEqual([]);
    expect(await eligibleAmong([userId], 2, 15)).toEqual([]);
  });
});

/**
 * Re-engagement — the lapse episode, end to end in SQL.
 *
 * The bug this suite pins shut: the daily sweep used to answer inactivity by
 * switching `notification_enabled` off. That flag is also a predicate of the
 * sweep's own candidate query, so re-engagement fired exactly once per account
 * and every later attempt selected nobody — a user who came back stayed silent
 * until they re-armed the toggle by hand, which nothing in the product ever asks
 * them to do. Two of the cases below ("does not unsubscribe" and "pings a second
 * episode") fail against that old design; the rest bound how loud the new one is.
 */
describe("notificationRepository re-engagement (integration)", () => {
  /** The lapsed ids this run created, among everything the global query returned. */
  async function dueAmong(ids: number[]): Promise<number[]> {
    const rows = await notificationRepository.getUsersForReEngagement();
    return rows.filter((row) => ids.includes(row.userId)).map((row) => row.userId);
  }

  async function readLapseState(userId: number): Promise<{
    notificationEnabled: boolean;
    reengagementCount: number;
    lastReengagementAt: Date | null;
  }> {
    const rows = await getDb()
      .select({
        notificationEnabled: userLanguageSettings.notificationEnabled,
        reengagementCount: userLanguageSettings.reengagementCount,
        lastReengagementAt: userLanguageSettings.lastReengagementAt,
      })
      .from(userLanguageSettings)
      .where(eq(userLanguageSettings.userId, userId));
    return rows[0]!;
  }

  const lapsed = (daysAgo = 20) => ({ lastInteractionAt: new Date(Date.now() - daysAgo * DAY_MS) });

  it("selects a subscriber who has gone quiet past the inactivity threshold", async () => {
    const userId = await seedNotifiableUser(lapsed());

    expect(await dueAmong([userId])).toEqual([userId]);
  });

  it("does not select a user who is still active", async () => {
    const userId = await seedNotifiableUser();

    expect(await dueAmong([userId])).toEqual([]);
  });

  it("does not select a user who has never interacted", async () => {
    // NULL means "never seen", not "lapsed" — they still get ordinary cards, so
    // nudging them to come back would be addressed to someone who never left.
    const userId = await seedNotifiableUser({ lastInteractionAt: null });

    expect(await dueAmong([userId])).toEqual([]);
  });

  it("does not select a user who opted out or was deactivated", async () => {
    const optedOut = await seedNotifiableUser({ ...lapsed(), notificationEnabled: false });
    const deactivated = await seedNotifiableUser({ ...lapsed(), isActive: false });

    expect(await dueAmong([optedOut, deactivated])).toEqual([]);
  });

  it("holds a ping back until the spacing interval has elapsed", async () => {
    const justPinged = await seedNotifiableUser({
      ...lapsed(),
      reengagementCount: 1,
      lastReengagementAt: new Date(Date.now() - 2 * DAY_MS),
    });
    const overdue = await seedNotifiableUser({
      ...lapsed(),
      reengagementCount: 1,
      lastReengagementAt: new Date(Date.now() - (REENGAGEMENT_INTERVAL_DAYS + 1) * DAY_MS),
    });

    expect(await dueAmong([justPinged, overdue])).toEqual([overdue]);
  });

  it("keeps selecting a long-gone user — the cadence has no ping cap", async () => {
    // The design this replaces stopped after four nudges and went quiet forever,
    // turning "nothing new to say" into "unreachable". A curated word every few
    // days is content the user subscribed to, so it simply continues.
    const longGone = await seedNotifiableUser({
      ...lapsed(120),
      reengagementCount: 40,
      lastReengagementAt: new Date(Date.now() - 60 * DAY_MS),
    });

    expect(await dueAmong([longGone])).toEqual([longGone]);
  });

  it("recording a ping advances the budget and does not unsubscribe the user", async () => {
    const userId = await seedNotifiableUser(lapsed());

    await notificationRepository.recordReEngagement(userId);

    const state = await readLapseState(userId);
    expect(state.reengagementCount).toBe(1);
    expect(state.lastReengagementAt).toBeInstanceOf(Date);
    // The whole point: going quiet is an episode, not an unsubscribe.
    expect(state.notificationEnabled).toBe(true);
    // ...and the freshly-stamped user is no longer due, so a second sweep the
    // same day cannot double-ping them.
    expect(await dueAmong([userId])).toEqual([]);
  });

  it("starts a clean episode after the user has come back and drifted away again", async () => {
    const userId = await seedNotifiableUser({
      ...lapsed(),
      reengagementCount: 7,
      lastReengagementAt: new Date(Date.now() - 30 * DAY_MS),
    });

    // The user comes back: the only signal the system gets, and what closes the
    // episode. The spacing clock is cleared too, so the next lapse is not paced
    // against a stamp from the previous one.
    await userRepository.updateLastInteraction(userId);
    expect(await readLapseState(userId)).toMatchObject({ reengagementCount: 0, lastReengagementAt: null });
    expect(await dueAmong([userId])).toEqual([]);

    // ...then drifts away again.
    await getDb()
      .update(userLanguageSettings)
      .set({ lastInteractionAt: new Date(Date.now() - 20 * DAY_MS) })
      .where(eq(userLanguageSettings.userId, userId));

    expect(await dueAmong([userId])).toEqual([userId]);
  });
});
