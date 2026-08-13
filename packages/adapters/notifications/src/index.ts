// Log helper
export { logNotificationSent } from "./log.js";

// Service factories
export {
  createContextualWordPicker,
  createDictionaryWordPicker,
  createNotificationService,
} from "./notification.service.js";

// Preset (curated hook word) layer
export { createPresetWordPicker, presetCandidates } from "./preset-picker.js";

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
  PresetWordPickerDeps,
  ReEngagementSendFn,
  SchedulerDeps,
  SendFn,
  SuggestedWord,
  TranslationBrief,
  VocabEntry,
  WordSource,
} from "./types.js";
