/**
 * Ports — abstraction interfaces for dependency injection.
 * These define the contract between core and adapters.
 */

export type { AIModel, AIPort, GenerateOptions } from "./ai.port.js";
export type { ServiceContainer } from "./container.js";
export type { FeatureAccessPort, FeatureAccessResult } from "./feature-access.port.js";
export { defaultFeatureAccess } from "./feature-access.port.js";
export type { CachedLanguage, LanguageCachePort } from "./language-cache.port.js";
export type {
  LanguageDetectionRepository,
  RecordLanguageDetectionEventInput,
} from "./language-detection.repository.js";
export type { NotificationRepository, NotificationType, NotificationUser } from "./notification.repository.js";
export type {
  OnboardingDemoCard,
  OnboardingDemoCardRepository,
  UpsertOnboardingDemoCardInput,
} from "./onboarding-demo-card.repository.js";
export type { IssueType, ReportedIssue, ReportedIssueRepository } from "./reported-issue.repository.js";
export type { RecordRequestTimingInput, RequestTimingRepository } from "./request-timing.repository.js";
export type { TranslationRequestRepository } from "./translation-request.repository.js";
export type { TranslationTemplateRepository } from "./translation-template.repository.js";
export type {
  ActivationNudgeCandidate,
  AudienceGroup,
  NewUser,
  SubscriptionPlan,
  User,
  UserLanguageSettings,
  UserRepository,
} from "./user.repository.js";
export { ACTIVATION_NUDGE_SOURCE } from "./user.repository.js";
export type {
  CreateVideoProcessInput,
  SaveVideoPhraseInput,
  VideoPhrase,
  VideoProcess,
  VideoVocabularyRepository,
} from "./video-vocabulary.repository.js";
export type {
  CreateVocabularyInput,
  UpdateTranslationData,
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyEntryWithSourceLang,
  VocabularyEntryWithTranslations,
  VocabularyRepository,
  VocabularySource,
  VocabularyTranslation,
} from "./vocabulary.repository.js";
export type {
  CreateWordPickerRunInput,
  WordPickerItem,
  WordPickerItemInput,
  WordPickerPreset,
  WordPickerPresetRepository,
  WordPickerRun,
  WordPickerRunRepository,
} from "./word-picker.repository.js";
export type { WordReviewRepository } from "./word-review.repository.js";
