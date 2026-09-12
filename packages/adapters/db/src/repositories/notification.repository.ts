import {
  DEFAULT_NOTIFICATION_TIME,
  formatNotificationTime,
  getLogger,
  INACTIVITY_DAYS,
  NOTIFICATION_TYPES,
  type NotificationType,
  type NotificationUser,
  parseNotificationMinutes,
  REENGAGEMENT_INTERVAL_DAYS,
} from "@polyglot/core";
import { and, desc, eq, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { notificationHistory, userLanguageSettings } from "../schema.js";

// Re-exported so existing adapter-db consumers (e.g. admin) are unaffected —
// these are pure notification-time helpers, now defined once in @polyglot/core
// alongside their NotificationType twin (Fable T22/B7).
// The lapse-policy numbers are not re-exported: import them from `@polyglot/core`.
export { DEFAULT_NOTIFICATION_TIME, formatNotificationTime, NOTIFICATION_TYPES, parseNotificationMinutes };

/* ------------------------------------------------------------------ */
/*  Domain constants — DB is the source of truth (db-sot policy)       */
/* ------------------------------------------------------------------ */

/** Default notification type (schema default) */
export const DEFAULT_NOTIFICATION_TYPE = "srs" as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How stale the last ping must be before the next one is due.
 *
 * Pings are spaced {@link REENGAGEMENT_INTERVAL_DAYS} apart, but the sweep only
 * runs once daily at 00:00 UTC. A strict compare against a stamp written moments
 * after the previous tick therefore misses by seconds and pushes every ping a
 * whole day late; the hour of slack absorbs that drift and is far too small to
 * let two pings land in one day.
 */
const REENGAGEMENT_INTERVAL_MS = REENGAGEMENT_INTERVAL_DAYS * DAY_MS - 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Get the local time in minutes since midnight for a given timezone and UTC time.
 * Uses Temporal API for reliable timezone conversion (handles DST).
 * Returns -1 for invalid timezones (caller should exclude).
 */
export function getLocalMinutes(timezone: string, utcHour: number, utcMinute: number): number {
  try {
    // Use today's date so DST offsets are correct (1970-01-01 lacks DST data)
    const now = Temporal.Now.zonedDateTimeISO("UTC");
    const dateStr = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.day).padStart(2, "0")}`;
    const h = String(utcHour).padStart(2, "0");
    const m = String(utcMinute).padStart(2, "0");
    const instant = Temporal.Instant.from(`${dateStr}T${h}:${m}:00Z`);
    const zoned = instant.toZonedDateTimeISO(timezone);
    return zoned.hour * 60 + zoned.minute;
  } catch {
    return -1;
  }
}

function isWithinCurrentNotificationSlot(localMinutes: number, targetMinutes: number): boolean {
  const elapsedMinutes = (localMinutes - targetMinutes + 1440) % 1440;
  return elapsedMinutes < 30;
}

/* ------------------------------------------------------------------ */
/*  Select shape (shared across queries)                               */
/* ------------------------------------------------------------------ */

const notificationUserSelect = {
  userId: userLanguageSettings.userId,
  interfaceLang: userLanguageSettings.interfaceLang,
  nativeLang: userLanguageSettings.nativeLang,
  learningLangs: userLanguageSettings.learningLangs,
  timezone: userLanguageSettings.timezone,
  notificationEnabled: userLanguageSettings.notificationEnabled,
  notificationTimes: userLanguageSettings.notificationTimes,
  notificationType: userLanguageSettings.notificationType,
  notificationContext: userLanguageSettings.notificationContext,
  reengagementCount: userLanguageSettings.reengagementCount,
} as const;

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const notificationRepository = {
  async getUsersForWindow(utcHour: number, utcMinute = 0): Promise<NotificationUser[]> {
    const db = getDb();
    const cutoff = new Date(Date.now() - INACTIVITY_DAYS * DAY_MS);

    const rows = await db
      .select(notificationUserSelect)
      .from(userLanguageSettings)
      .where(
        and(
          eq(userLanguageSettings.notificationEnabled, true),
          eq(userLanguageSettings.isActive, true),
          or(isNull(userLanguageSettings.lastInteractionAt), gte(userLanguageSettings.lastInteractionAt, cutoff)),
        ),
      );

    let droppedByTimezone = 0;
    const eligible = rows.filter((user) => {
      const localMinutes = getLocalMinutes(user.timezone, utcHour, utcMinute);
      if (localMinutes < 0) {
        droppedByTimezone++;
        return false;
      }
      // Eligible if ANY slot falls in the current window. An empty list means the
      // user has never picked a time, not that they want silence — since
      // notifications ship switched on, treating empty as "never send" would make
      // the default inert for everyone who has not opened Settings, which is
      // almost everyone.
      const slots = user.notificationTimes.length > 0 ? user.notificationTimes : [DEFAULT_NOTIFICATION_TIME];
      return slots.some((time) => isWithinCurrentNotificationSlot(localMinutes, parseNotificationMinutes(time)));
    });

    // An unparseable timezone excludes a subscriber from every window forever,
    // and until now did so in complete silence — which is precisely how a total
    // notification outage hides. Counted, not merely returned.
    if (droppedByTimezone > 0) {
      getLogger().warn(
        { droppedByTimezone, utcHour, utcMinute },
        "Subscribers excluded from the notification window by an unparseable timezone",
      );
    }

    return eligible;
  },

  /**
   * Lapsed subscribers whose next re-engagement card is due.
   *
   * Lapsing deliberately does NOT unsubscribe anyone: the sweep used to flip
   * `notification_enabled` off, which also dropped the user out of this very
   * query, so re-engagement fired exactly once per account and a returning user
   * stayed silent forever. Users with a NULL `last_interaction_at` have never
   * been seen and are not lapsed — they keep receiving ordinary cards.
   *
   * There is no ping cap: a lapsed subscriber keeps getting one curated word
   * every {@link REENGAGEMENT_INTERVAL_DAYS} until they come back, switch
   * notifications off, or block the bot.
   */
  async getUsersForReEngagement(): Promise<NotificationUser[]> {
    const db = getDb();
    const now = Date.now();
    const lapsedBefore = new Date(now - INACTIVITY_DAYS * DAY_MS);
    const pingedBefore = new Date(now - REENGAGEMENT_INTERVAL_MS);

    return db
      .select(notificationUserSelect)
      .from(userLanguageSettings)
      .where(
        and(
          eq(userLanguageSettings.notificationEnabled, true),
          eq(userLanguageSettings.isActive, true),
          isNotNull(userLanguageSettings.lastInteractionAt),
          lt(userLanguageSettings.lastInteractionAt, lapsedBefore),
          or(
            isNull(userLanguageSettings.lastReengagementAt),
            lt(userLanguageSettings.lastReengagementAt, pingedBefore),
          ),
        ),
      );
  },

  /**
   * Stamp a re-engagement card: the timestamp paces the next one, and the counter
   * is how anyone can later answer "how many nudges does it take" — it is read
   * back into every sweep's log line, and it is the only record of how deep into
   * an episode a user is, since nothing else survives their return.
   *
   * Incremented in SQL rather than from the value the sweep read, so a card
   * recorded by a concurrent tick is never silently overwritten back down.
   */
  async recordReEngagement(userId: number): Promise<void> {
    const db = getDb();
    await db
      .update(userLanguageSettings)
      .set({
        lastReengagementAt: new Date(),
        reengagementCount: sql`${userLanguageSettings.reengagementCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(userLanguageSettings.userId, userId));
  },

  /**
   * Disable notifications for a user (e.g., due to inactivity).
   */
  async disableNotifications(userId: number): Promise<void> {
    const db = getDb();
    await db
      .update(userLanguageSettings)
      .set({ notificationEnabled: false, updatedAt: new Date() })
      .where(eq(userLanguageSettings.userId, userId));
  },

  async updatePrefs(
    userId: number,
    prefs: {
      notificationEnabled?: boolean;
      notificationTimes?: string[];
      notificationType?: NotificationType;
      notificationContext?: string | null;
    },
  ): Promise<void> {
    const db = getDb();
    const set: Record<string, unknown> = {};
    if (prefs.notificationEnabled !== undefined) set.notificationEnabled = prefs.notificationEnabled;
    if (prefs.notificationTimes !== undefined) set.notificationTimes = prefs.notificationTimes;
    if (prefs.notificationType !== undefined) set.notificationType = prefs.notificationType;
    if (prefs.notificationContext !== undefined) set.notificationContext = prefs.notificationContext;
    set.updatedAt = new Date();

    await db.update(userLanguageSettings).set(set).where(eq(userLanguageSettings.userId, userId));
  },

  async recordSentWord(userId: number, original: string, source: string): Promise<void> {
    const db = getDb();
    await db.insert(notificationHistory).values({ userId, original, source });
  },

  /**
   * The single most recently notified word, ignoring age.
   *
   * The rolling de-dup window answers "what has this user seen lately"; this
   * answers "what did they see last", which is the only thing that can
   * guarantee no word arrives twice in a row once the window rolls over.
   */
  async getLastSentWord(userId: number): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select({ original: notificationHistory.original })
      .from(notificationHistory)
      .where(eq(notificationHistory.userId, userId))
      .orderBy(desc(notificationHistory.sentAt))
      .limit(1);
    return rows[0]?.original ?? null;
  },

  async getSentWordsSince(userId: number, since: Date): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ original: notificationHistory.original })
      .from(notificationHistory)
      .where(and(eq(notificationHistory.userId, userId), gte(notificationHistory.sentAt, since)));
    return rows.map((r) => r.original);
  },
};
