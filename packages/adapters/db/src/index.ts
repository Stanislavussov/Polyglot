import * as schema from "./schema.js";

// Database connection — extracted to connection.ts to avoid circular deps
export type { Db } from "./connection.js";
export { closeDb, getDb } from "./connection.js";
export { createContextLookup } from "./context-lookup.js";
export type { CachedLanguage } from "./language-cache.js";
// Language cache — loaded from DB, serves all language metadata
export {
  getAllLangs,
  getLang,
  getLangDisplay,
  getLangFlag,
  getLangName,
  getLangNativeName,
  getSupportedLangs,
  isKnownLang,
  isLanguageCacheLoaded,
  loadLanguageCache,
  normalizeToIso1,
} from "./language-cache.js";
export type {
  Language,
  NewLanguage,
} from "./repositories/language.repository.js";
export { languageRepository } from "./repositories/language.repository.js";
export type {
  NotificationType,
  NotificationUser,
} from "./repositories/notification.repository.js";
export {
  DEFAULT_NOTIFICATION_HOUR,
  DEFAULT_NOTIFICATION_TYPE,
  formatNotificationHour,
  INACTIVITY_DAYS,
  MAX_NOTIFICATION_HOUR,
  MIN_NOTIFICATION_HOUR,
  NOTIFICATION_TYPES,
  notificationRepository,
  parseNotificationHour,
} from "./repositories/notification.repository.js";
export { reportedIssueRepository } from "./repositories/reported-issue.repository.js";
export type {
  NewTopicTranslation,
  TopicTranslation,
} from "./repositories/topic.repository.js";
export { topicRepository } from "./repositories/topic.repository.js";
export type { TranslationRequestDTO } from "./repositories/translation-request.repository.js";
export { translationRequestRepository } from "./repositories/translation-request.repository.js";
export type { SavedTranslationTemplate } from "./repositories/translation-template.repository.js";
export { translationTemplateRepository } from "./repositories/translation-template.repository.js";
export type {
  NewUser,
  NewUserLanguageSettings,
  User,
  UserLanguageSettings,
} from "./repositories/user.repository.js";
// Re-export repositories and types
export { MAX_LEARNING_LANGS, userRepository } from "./repositories/user.repository.js";
export type {
  CreateVocabularyInput,
  UpdateTranslationData,
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyEntryWithSourceLang,
  VocabularyEntryWithTranslations,
  VocabularyTranslation,
} from "./repositories/vocabulary.repository.js";
export { vocabularyRepository } from "./repositories/vocabulary.repository.js";
export type { WordReview } from "./repositories/word-review.repository.js";
export { wordReviewRepository } from "./repositories/word-review.repository.js";
export { wordContextRepository } from "./repositories/word-context.repository.js";
export type { IssueStatus, IssueType, ReportedIssue } from "./schema.js";
export * from "./schema.js";
export { schema };
