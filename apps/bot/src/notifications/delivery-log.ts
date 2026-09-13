import type { RecordNotificationDeliveryInput } from "@polyglot/adapter-db";
import { errorFields, logEvent } from "@polyglot/core";

/** Where a proactive message is journaled once Telegram has accepted it. */
export interface NotificationDeliveryLog {
  record(input: RecordNotificationDeliveryInput): Promise<void>;
}

/**
 * Journal a message that has already reached the chat. Never throws: a rejection
 * here would land in the scheduler's retry ladder or a sweep's transient-failure
 * branch, and both answer it by sending the same message again.
 */
export async function logDelivery(log: NotificationDeliveryLog, input: RecordNotificationDeliveryInput): Promise<void> {
  try {
    await log.record(input);
  } catch (err) {
    logEvent("notification.delivery_log_failed", { kind: input.kind, ...errorFields(err) }, "error");
  }
}
