import type { NotificationType, NotificationUser } from "@polyglot/core";
import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../connection.js";
import { notificationHistory, userLanguageSettings, users } from "../schema.js";

/* ------------------------------------------------------------------ */
/*  Domain constants — DB is the source of truth (db-sot policy)       */
/* ------------------------------------------------------------------ */

/** Valid notification type strategies */
export const NOTIFICATION_TYPES = ["suggested", "srs"] as const;
/** Default notification time (08:00 local). Stored as "HH:MM" string in DB. */
export const DEFAULT_NOTIFICATION_TIME = "08:00";
/** Default notification type (schema default) */
export const DEFAULT_NOTIFICATION_TYPE = "srs" as const;
/** Days of inactivity before pausing notifications */
export const INACTIVITY_DAYS = 14;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Parse the notification_time DB value ("HH:MM") into total minutes since midnight.
 * Returns DEFAULT_NOTIFICATION_TIME minutes for invalid/missing values.
 */
export function parseNotificationMinutes(value: string | null | undefined): number {
  if (value == null) {
    const [h, m] = DEFAULT_NOTIFICATION_TIME.split(":").map(Number);
    return h * 60 + m;
  }
  const parts = value.split(":");
  if (parts.length !== 2) return 8 * 60; // fallback 08:00
  const h = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return 8 * 60; // fallback 08:00
  }
  return h * 60 + m;
}

/**
 * Format total minutes since midnight as "HH:MM" (e.g. "08:00", "14:30").
 */
export function formatNotificationTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

const NOTIFICATION_TIME_TOLERANCE_MINUTES = 1;

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

/* ------------------------------------------------------------------ */
/*  Select shape (shared across queries)                               */
/* ------------------------------------------------------------------ */

const notificationUserSelect = {
  userId: userLanguageSettings.userId,
  telegramId: users.telegramId,
  interfaceLang: userLanguageSettings.interfaceLang,
  nativeLang: userLanguageSettings.nativeLang,
  learningLangs: userLanguageSettings.learningLangs,
  timezone: userLanguageSettings.timezone,
  notificationEnabled: userLanguageSettings.notificationEnabled,
  notificationTime: userLanguageSettings.notificationTime,
  notificationType: userLanguageSettings.notificationType,
} as const;

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const notificationRepository = {
  /**
   * Get users eligible for notification at the given UTC hour and minute.
   * Returns users where:
   * - notification_enabled = true
   * - is_active = true
   * - last_interaction_at within INACTIVITY_DAYS or NULL (unknown = include)
   * - local time matches their preferred notification time (within 30-min window)
   */
  async getUsersForWindow(utcHour: number, utcMinute = 0): Promise<NotificationUser[]> {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - INACTIVITY_DAYS);

    const rows = await db
      .select(notificationUserSelect)
      .from(userLanguageSettings)
      .innerJoin(users, eq(users.id, userLanguageSettings.userId))
      .where(
        and(
          eq(userLanguageSettings.notificationEnabled, true),
          eq(userLanguageSettings.isActive, true),
          or(isNull(userLanguageSettings.lastInteractionAt), gte(userLanguageSettings.lastInteractionAt, cutoff)),
        ),
      );

    return rows.filter((user) => {
      const localMinutes = getLocalMinutes(user.timezone, utcHour, utcMinute);
      if (localMinutes < 0) return false;
      const targetMinutes = parseNotificationMinutes(user.notificationTime);
      return Math.abs(localMinutes - targetMinutes) <= NOTIFICATION_TIME_TOLERANCE_MINUTES;
    });
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
      .innerJoin(users, eq(users.id, userLanguageSettings.userId))
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
      notificationTime?: string;
      notificationType?: NotificationType;
    },
  ): Promise<void> {
    const db = getDb();
    const set: Record<string, unknown> = {};
    if (prefs.notificationEnabled !== undefined) set.notificationEnabled = prefs.notificationEnabled;
    if (prefs.notificationTime !== undefined) set.notificationTime = prefs.notificationTime;
    if (prefs.notificationType !== undefined) set.notificationType = prefs.notificationType;
    set.updatedAt = new Date();

    await db.update(userLanguageSettings).set(set).where(eq(userLanguageSettings.userId, userId));
  },

  async recordSentWord(userId: number, original: string, source: string): Promise<void> {
    const db = getDb();
    await db.insert(notificationHistory).values({ userId, original, source });
  },

  async getRecentSentWords(userId: number, limit = 3): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ original: notificationHistory.original })
      .from(notificationHistory)
      .where(eq(notificationHistory.userId, userId))
      .orderBy(desc(notificationHistory.sentAt))
      .limit(limit);
    return rows.map((r) => r.original);
  },
};
