import { and, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../connection.js";
import { userLanguageSettings, users } from "../schema.js";

/* ------------------------------------------------------------------ */
/*  Domain constants — DB is the source of truth (db-sot policy)       */
/* ------------------------------------------------------------------ */

/** Valid notification type strategies */
export const NOTIFICATION_TYPES = ["suggested", "srs", "both"] as const;
/** Default notification hour (08:00 local). Stored as integer string in DB. */
export const DEFAULT_NOTIFICATION_HOUR = 8;
/** Default notification type (schema default) */
export const DEFAULT_NOTIFICATION_TYPE = "both" as const;
/** Minimum valid notification hour (inclusive) */
export const MIN_NOTIFICATION_HOUR = 0;
/** Maximum valid notification hour (inclusive) */
export const MAX_NOTIFICATION_HOUR = 23;
/** Days of inactivity before pausing notifications */
export const INACTIVITY_DAYS = 14;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationUser = {
  userId: number;
  telegramId: number;
  interfaceLang: string;
  nativeLang: string;
  learningLangs: string[];
  timezone: string;
  notificationTime: string;
  notificationType: string;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Parse the notification_time DB value (string) into an integer hour (0-23).
 * Returns DEFAULT_NOTIFICATION_HOUR for invalid/missing values.
 */
export function parseNotificationHour(value: string | null | undefined): number {
  if (value == null) return DEFAULT_NOTIFICATION_HOUR;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < MIN_NOTIFICATION_HOUR || parsed > MAX_NOTIFICATION_HOUR) {
    return DEFAULT_NOTIFICATION_HOUR;
  }
  return parsed;
}

/**
 * Format an hour (0-23) as a human-readable time string (e.g. "08:00", "14:00").
 */
export function formatNotificationHour(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

/**
 * Get the local hour for a timezone given a UTC hour.
 * Uses Intl.DateTimeFormat for reliable timezone conversion (handles DST).
 * Returns -1 for invalid timezones (caller should exclude).
 */
export function getLocalHour(timezone: string, utcHour: number): number {
  try {
    const date = new Date();
    date.setUTCHours(utcHour, 0, 0, 0);
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    return hourPart ? Number.parseInt(hourPart.value, 10) : -1;
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
  notificationTime: userLanguageSettings.notificationTime,
  notificationType: userLanguageSettings.notificationType,
} as const;

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const notificationRepository = {
  /**
   * Get users eligible for notification at the given UTC hour.
   * Returns users where:
   * - notification_enabled = true
   * - is_active = true
   * - last_interaction_at within INACTIVITY_DAYS or NULL (unknown = include)
   * - local hour matches their preferred notification time slot (morning=8, evening=20)
   */
  async getUsersForWindow(hour: number): Promise<NotificationUser[]> {
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

    // Filter by timezone: user's local hour must match their preferred notification hour
    return rows.filter((user) => {
      const localHour = getLocalHour(user.timezone, hour);
      const targetHour = parseNotificationHour(user.notificationTime);
      return localHour === targetHour;
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
};
