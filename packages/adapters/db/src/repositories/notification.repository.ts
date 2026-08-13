import {
  DEFAULT_NOTIFICATION_TIME,
  formatNotificationTime,
  getLogger,
  NOTIFICATION_TYPES,
  type NotificationType,
  type NotificationUser,
  parseNotificationMinutes,
} from "@polyglot/core";
import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../connection.js";
import { notificationHistory, userLanguageSettings } from "../schema.js";

// Re-exported so existing adapter-db consumers (e.g. admin) are unaffected —
// these are pure notification-time helpers, now defined once in @polyglot/core
// alongside their NotificationType twin (Fable T22/B7).
export { DEFAULT_NOTIFICATION_TIME, formatNotificationTime, NOTIFICATION_TYPES, parseNotificationMinutes };

/* ------------------------------------------------------------------ */
/*  Domain constants — DB is the source of truth (db-sot policy)       */
/* ------------------------------------------------------------------ */

/** Default notification type (schema default) */
export const DEFAULT_NOTIFICATION_TYPE = "srs" as const;
/** Days of inactivity before pausing notifications */
export const INACTIVITY_DAYS = 14;

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
} as const;

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const notificationRepository = {
  async getUsersForWindow(utcHour: number, utcMinute = 0): Promise<NotificationUser[]> {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INACTIVITY_DAYS);

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
      // Eligible if ANY configured slot falls in the current window. Empty list = not configured.
      return user.notificationTimes.some((time) =>
        isWithinCurrentNotificationSlot(localMinutes, parseNotificationMinutes(time)),
      );
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
   * Get users with notifications enabled but inactive for more than INACTIVITY_DAYS.
   * Used for re-engagement flow (Task 41.7).
   * Users with NULL last_interaction_at are NOT considered inactive.
   */
  async getInactiveUsers(): Promise<NotificationUser[]> {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INACTIVITY_DAYS);

    return db
      .select(notificationUserSelect)
      .from(userLanguageSettings)
      .where(
        and(
          eq(userLanguageSettings.notificationEnabled, true),
          eq(userLanguageSettings.isActive, true),
          isNotNull(userLanguageSettings.lastInteractionAt),
          lt(userLanguageSettings.lastInteractionAt, cutoff),
        ),
      );
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
