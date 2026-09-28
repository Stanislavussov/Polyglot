/** Cards one scheduled notification may carry — the only sizes the settings screen offers or stores. */
export const NOTIFICATION_BATCH_SIZES = [1, 3, 5, 10] as const;

export type NotificationBatchSize = (typeof NOTIFICATION_BATCH_SIZES)[number];

/** Schema default: one word, the nudge as it was before the setting existed. */
export const DEFAULT_NOTIFICATION_BATCH_SIZE: NotificationBatchSize = 1;

export function isNotificationBatchSize(value: number): value is NotificationBatchSize {
  return (NOTIFICATION_BATCH_SIZES as readonly number[]).includes(value);
}
