// Logger — singleton pino, also exported from here for convenience

export type {
  AIFailover,
  AIModel,
  AIPort,
  ChatMessage,
  ChatOptions,
  GenerateObjectFn,
  GenerateOptions,
} from "./ports/ai.port.js";
// Ports — service container for dependency injection
export type { ServiceContainer } from "./ports/container.js";
export type { FeatureAccessPort, FeatureAccessResult, FeatureAccessSubject } from "./ports/feature-access.port.js";
export { defaultFeatureAccess } from "./ports/feature-access.port.js";
export type { IdentityRepository } from "./ports/identity.repository.js";
export type { CachedLanguage, LanguageCachePort } from "./ports/language-cache.port.js";
export type {
  LanguageDetectionRepository,
  RecordLanguageDetectionEventInput,
} from "./ports/language-detection.repository.js";
export type {
  NotificationType,
  NotificationUser,
} from "./ports/notification.repository.js";
export type { CheckoutResult, PaymentPort, RenewableSubscription, RenewalResult } from "./ports/payment.port.js";
export type {
  IssueType,
  ReportedIssue,
  ReportedIssueRepository,
} from "./ports/reported-issue.repository.js";
export type {
  RecordRequestTimingInput,
  RequestTimingRepository,
} from "./ports/request-timing.repository.js";
export type {
  AIGenerationDefaults,
  DictionaryConfig,
  NotificationDefaults,
  PlanLimitConfig,
  SettingsPort,
  SrsConfig,
  TranslationPresetConfig,
  VideoVocabularyConfig,
} from "./ports/settings.port.js";
export type {
  CreateSubscriptionInput,
  Subscription,
  SubscriptionRepository,
  SubscriptionStatus,
} from "./ports/subscription.repository.js";
export type {
  TranslationRequest,
  TranslationRequestRepository,
} from "./ports/translation-request.repository.js";
export type {
  AudienceGroup,
  NewUser,
  SubscriptionPlan,
  User,
  UserLanguageSettings,
  UserLearningLanguage,
} from "./ports/user.repository.js";
export type {
  VideoPhrase,
  VideoProcess,
  VideoVocabularyRepository,
} from "./ports/video-vocabulary.repository.js";
export type {
  CreateVocabularyInput,
  DictionaryListOptions,
  DictionaryListSort,
  SrsDueVocabularyCard,
  UpdateSrsStateInput,
  UpdateTranslationData,
  VocabTranslationDetails,
  VocabularyEntry,
  VocabularyEntryWithSourceLang,
  VocabularyEntryWithTranslations,
  VocabularyRepository,
  VocabularySource,
  VocabularyTranslation,
} from "./ports/vocabulary.repository.js";
export type {
  VocabularyDictionary,
  VocabularyDictionaryRepository,
  VocabularyDictionaryWithCount,
} from "./ports/vocabulary-dictionary.repository.js";

// Logger

export { logger } from "./logger.js";
export type { Logger } from "./logger-interface.js";
export { getLogger, setLogger } from "./logger-interface.js";

// Modules

export * from "./modules/context-enrichment/index.js";
export * from "./modules/dictionary-pipeline/index.js";
export * from "./modules/entitlements/index.js";
export * from "./modules/i18n/index.js";
export * from "./modules/idiom-analysis/index.js";
export * from "./modules/input-analysis/index.js";
export * from "./modules/language-detect/index.js";
export type { MentorPromptOptions } from "./modules/mentor/prompt.builder.js";
export { buildMentorSystemPrompt, MAX_MENTOR_HISTORY } from "./modules/mentor/prompt.builder.js";
export * from "./modules/notifications/index.js";
export * from "./modules/rate-limit/index.js";
export { AI_GENERATION_DEFAULTS, parseAIGenerationDefaults } from "./modules/settings/ai-defaults.schema.js";
export * from "./modules/settings/settings.service.js";
export * from "./modules/srs/index.js";
export * from "./modules/subscriptions/index.js";
export * from "./modules/topics/index.js";
export * from "./modules/translation/index.js";
export type {
  ExampleInput,
  ValidateInput,
  ValidationError,
  ValidationResult,
} from "./modules/validation/index.js";
// Validation — ExpressionType is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export {
  validate,
  validateExamples,
  validateSchema,
  validateSemantic,
} from "./modules/validation/index.js";
export type { ExtractedPhrase, ExtractionResult } from "./modules/video-vocabulary/index.js";
export {
  buildExtractionPrompt,
  computePhraseTarget,
  extractedPhraseSchema,
  extractionResultSchema,
  extractPhrasesFromTranscript,
} from "./modules/video-vocabulary/index.js";
export {
  type AICircuitEvent,
  type AICircuitObserver,
  BreakerRegistry,
  getBreaker,
  resetBreakerRegistry,
  setAICircuitObserver,
} from "./resilience/breaker-registry.js";
export type { CircuitBreakerConfig, CircuitState } from "./resilience/circuit-breaker.js";
// Resilience — per-model circuit breaker (Phase 3)
export { CircuitBreaker } from "./resilience/circuit-breaker.js";
// Shared
export * from "./shared/errors.js";
export { isFinitePositive } from "./shared/numbers.js";
export type { InputContext } from "./shared/translation-template.service.js";
export {
  resolveOutputConfig,
  resolveTemplate,
} from "./shared/translation-template.service.js";
export type {
  TemplateFields,
  UserTranslationTemplate,
} from "./shared/translation-template.types.js";
export {
  DEFAULT_TEMPLATE,
  TEMPLATE_FIELD_KEYS,
  templateToOutputConfig,
} from "./shared/translation-template.types.js";
