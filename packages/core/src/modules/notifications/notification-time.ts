/**
 * Notification time helpers — pure functions over the "HH:MM" wire format
 * used for user-configured notification slots. No DB access; the adapter
 * layer only persists the string form.
 */

/** Valid notification type strategies */
export const NOTIFICATION_TYPES = ["suggested", "srs", "contextual"] as const;
/** Default notification time (08:00 local). Stored as "HH:MM" string in DB. */
export const DEFAULT_NOTIFICATION_TIME = "08:00";

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
