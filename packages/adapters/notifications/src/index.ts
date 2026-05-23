// Log helper
export { logNotificationSent } from "./log.js";

// Service factory
export { createNotificationService } from "./notification.service.js";

// Scheduler
export {
  buildNotificationPayload,
  checkAndSend,
  processInactiveUsers,
  startScheduler,
  stopScheduler,
} from "./scheduler.js";

// Types
export type {
  NotificationPayload,
  NotificationServiceDeps,
  NotificationType,
  NotificationUser,
  ReEngagementSendFn,
  SchedulerDeps,
  SendFn,
  SuggestedWord,
  VocabEntry,
} from "./types.js";
