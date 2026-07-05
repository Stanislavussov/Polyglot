// Log helper
export { logNotificationSent } from "./log.js";

// Service factories
export {
  createContextualWordPicker,
  createDictionaryWordPicker,
  createNotificationService,
} from "./notification.service.js";

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
  ContextualWordPickerDeps,
  DictionaryWordPickerDeps,
  NotificationPayload,
  NotificationServiceDeps,
  NotificationType,
  NotificationUser,
  ReEngagementSendFn,
  SchedulerDeps,
  SendFn,
  SuggestedWord,
  TranslationBrief,
  VocabEntry,
} from "./types.js";
