import { logger } from "@polyglot/infra";

/**
 * Log a successfully dispatched notification.
 * Called by the scheduler after each successful send.
 */
export function logNotificationSent(params: {
  userId: number;
  type: "suggested";
  wordId: number;
}): void {
  logger.info(params, "Notification sent");
}

// Service factory
export { createNotificationService } from "./notification.service.js";

// Types
export type {
  SendFn,
  UserForNotification,
  NotificationPayload,
  SuggestedWord,
  NotificationServiceDeps,
} from "./types.js";
