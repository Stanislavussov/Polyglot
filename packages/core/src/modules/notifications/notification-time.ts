/**
 * Notification time helpers — pure functions over the "HH:MM" wire format
 * used for user-configured notification slots. No DB access; the adapter
 * layer only persists the string form.
 */

/** Valid notification type strategies */
export const NOTIFICATION_TYPES = ["suggested", "srs", "contextual"] as const;
/**
 * Last-resort notification time (19:00 local), stored as an "HH:MM" string.
 *
 * This is a **parse fallback**, not the product default. The value a new user's
 * schedule is actually seeded with comes from the admin-managed
 * `notifications.defaultTime` setting, read at the moment they turn notifications
 * on; this constant only answers "what does an unparseable stored string mean".
 * The two are kept at the same value so a malformed row does not silently move
 * someone to a different hour than the product intends.
 *
 * Note the one case where changing this constant *does* move a user without any
 * write: a row holding an unparseable `notification_times` entry previously
 * matched the 08:00 window and now matches 19:00. Measured on the **dev**
 * database (7 rows, after migration `0050`): 0 rows hold an entry failing
 * `^([01]\d|2[0-3]):[0-5]\d$`. That is the expected result — every writer goes
 * through {@link formatNotificationTime} — but dev is not production, so the
 * same read-only query is on the pre-deploy checklist in
 * `@docs/adr/0001-scheduled-notifications-are-a-subscription.md`.
 */
export const DEFAULT_NOTIFICATION_TIME = "19:00";

/** {@link DEFAULT_NOTIFICATION_TIME} in minutes since midnight. */
function defaultMinutes(): number {
  const [h, m] = DEFAULT_NOTIFICATION_TIME.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * Parse the notification_time DB value ("HH:MM") into total minutes since midnight.
 * Returns DEFAULT_NOTIFICATION_TIME minutes for invalid/missing values.
 */
export function parseNotificationMinutes(value: string | null | undefined): number {
  if (value == null) return defaultMinutes();
  const parts = value.split(":");
  if (parts.length !== 2) return defaultMinutes();
  const h = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return defaultMinutes();
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
