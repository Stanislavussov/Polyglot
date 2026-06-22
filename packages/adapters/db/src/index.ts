import * as schema from "./schema.js";

export type { CachedLanguage } from "@polyglot/core";
// Database connection — extracted to connection.ts to avoid circular deps
export type { Db } from "./connection.js";
export { closeDb, getDb } from "./connection.js";
export { createContextLookup } from "./context-lookup.js";
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
export type { AdminUser } from "./repositories/admin-user.repository.js";
export { adminUserRepository } from "./repositories/admin-user.repository.js";
export type { AIModelRow, AIModelWithPlans } from "./repositories/ai-model.repository.js";
export { aiModelRepository } from "./repositories/ai-model.repository.js";
export type {
  AIRequestKind,
  AIRequestLatencySummary,
  RecordAIRequestLatencyInput,
} from "./repositories/ai-request-latency.repository.js";
export { aiRequestLatencyRepository } from "./repositories/ai-request-latency.repository.js";
export type { StoredBotSession } from "./repositories/bot-session.repository.js";
export { BOT_SESSION_VERSION, botSessionRepository } from "./repositories/bot-session.repository.js";
export type {
  Language,
  NewLanguage,
} from "./repositories/language.repository.js";
export { languageRepository } from "./repositories/language.repository.js";
export type {
  LanguageDetectionDaySummary,
  LanguageDetectionOutcomeSummary,
  RecordLanguageDetectionEventInput,
} from "./repositories/language-detection.repository.js";
export { languageDetectionRepository } from "./repositories/language-detection.repository.js";
export {
  DEFAULT_NOTIFICATION_TIME,
  DEFAULT_NOTIFICATION_TYPE,
  formatNotificationTime,
  getLocalMinutes,
  INACTIVITY_DAYS,
  NOTIFICATION_TYPES,
  notificationRepository,
  parseNotificationMinutes,
} from "./repositories/notification.repository.js";
export type { RateLimitPlan } from "./repositories/rate-limit-plan.repository.js";
export { rateLimitPlanRepository } from "./repositories/rate-limit-plan.repository.js";
export { reportedIssueRepository } from "./repositories/reported-issue.repository.js";
export type {
  RecordRequestTimingInput,
  RequestTimingModelSummary,
  RequestTimingSegmentSummary,
} from "./repositories/request-timing.repository.js";
export { requestTimingRepository } from "./repositories/request-timing.repository.js";
export { systemSettingsRepository } from "./repositories/system-settings.repository.js";
export type {
  NewTopicTranslation,
  TopicTranslation,
} from "./repositories/topic.repository.js";
export { topicRepository } from "./repositories/topic.repository.js";
export type { PresetConfig, TranslationPreset } from "./repositories/translation-preset.repository.js";
export { translationPresetRepository } from "./repositories/translation-preset.repository.js";
export type { TranslationRequest } from "./repositories/translation-request.repository.js";
export { translationRequestRepository } from "./repositories/translation-request.repository.js";
export type { SavedTranslationTemplate } from "./repositories/translation-template.repository.js";
export { translationTemplateRepository } from "./repositories/translation-template.repository.js";
export type {
  AudienceGroup,
  NewUser,
  SubscriptionPlan,
  User,
  UserLanguageSettings,
} from "./repositories/user.repository.js";
// Re-export repositories and types
export {
  AUDIENCE_GROUPS,
  isAudienceGroup,
  MAX_LEARNING_LANGS,
  userRepository,
} from "./repositories/user.repository.js";
export type { UserRequestCountRow } from "./repositories/user-request-count.repository.js";
export { userRequestCountRepository } from "./repositories/user-request-count.repository.js";
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
export type {
  VocabularyDictionary,
  VocabularyDictionaryWithCount,
} from "./repositories/vocabulary-dictionary.repository.js";
export {
  DEFAULT_DICTIONARY_NAME,
  vocabularyDictionaryRepository,
} from "./repositories/vocabulary-dictionary.repository.js";
export { wordContextRepository } from "./repositories/word-context.repository.js";
export type { WordReview } from "./repositories/word-review.repository.js";
export { wordReviewRepository } from "./repositories/word-review.repository.js";
export type {
  IssueStatus,
  IssueType,
  NotificationHistory,
  ReleaseAnnouncementDelivery,
  ReportedIssue,
} from "./schema.js";
export * from "./schema.js";
export { notificationHistory } from "./schema.js";
export { settingsAdapter } from "./settings-adapter.js";
export { schema };
