/**
 * Service Container — aggregates all port interfaces into a single DI container.
 */
import type { ContextLookupFn } from "../modules/context-enrichment/types.js";
import type { FindWordLanguagesFn } from "../modules/language-detect/types.js";
import type { MomentumService } from "../modules/momentum/momentum.service.js";
import type { AIPort } from "./ai.port.js";
import type { FeatureAccessPort } from "./feature-access.port.js";
import type { IdentityRepository } from "./identity.repository.js";
import type { LanguageCachePort } from "./language-cache.port.js";
import type { LanguageDetectionRepository } from "./language-detection.repository.js";
import type { MentorMessageRepository } from "./mentor-message.repository.js";
import type { NotificationRepository } from "./notification.repository.js";
import type { OnboardingDemoCardRepository } from "./onboarding-demo-card.repository.js";
import type { PaymentPort } from "./payment.port.js";
import type { ReportedIssueRepository } from "./reported-issue.repository.js";
import type { RequestTimingRepository } from "./request-timing.repository.js";
import type { SettingsPort } from "./settings.port.js";
import type { SubscriptionRepository } from "./subscription.repository.js";
import type { TranslationRequestRepository } from "./translation-request.repository.js";
import type { TranslationTemplateRepository } from "./translation-template.repository.js";
import type { TtsCacheRepository } from "./tts-cache.repository.js";
import type { UserRepository } from "./user.repository.js";
import type { VideoVocabularyRepository } from "./video-vocabulary.repository.js";
import type { VocabularyRepository } from "./vocabulary.repository.js";
import type { VocabularyDictionaryRepository } from "./vocabulary-dictionary.repository.js";
import type { WordPickerPresetRepository, WordPickerRunRepository } from "./word-picker.repository.js";
import type { WordReviewRepository } from "./word-review.repository.js";

/**
 * Service Container — aggregates all port interfaces.
 * This is the composition root interface.
 */
export interface ServiceContainer {
  userRepository: UserRepository;
  /** Channel identity resolution (userId ↔ channel externalId), Fable T24/A1. */
  identityRepository: IdentityRepository;
  vocabularyRepository: VocabularyRepository;
  vocabularyDictionaryRepository: VocabularyDictionaryRepository;
  translationTemplateRepository: TranslationTemplateRepository;
  wordReviewRepository: WordReviewRepository;
  notificationRepository: NotificationRepository;
  /** Durable mentor-chat threads — reply-continuation lookups and history (mentor MVP). */
  mentorMessageRepository: MentorMessageRepository;
  /** Effort journal and momentum snapshot — the only writer of `momentum_events` (Task 81). */
  momentumService: MomentumService;
  translationRequestRepository: TranslationRequestRepository;
  languageDetectionRepository: LanguageDetectionRepository;
  requestTimingRepository: RequestTimingRepository;
  reportedIssueRepository: ReportedIssueRepository;
  /** Pre-rendered onboarding hook cards (Task 72). */
  onboardingDemoCardRepository: OnboardingDemoCardRepository;
  languageCache: LanguageCachePort;
  ai: AIPort;
  settings: SettingsPort;
  /** Pronunciation cache — Telegram file_ids for already-synthesized words (Task 77). */
  ttsCacheRepository: TtsCacheRepository;
  /** Dictionary context lookup used by the translate enrichment layer. */
  contextLookup: ContextLookupFn;
  /** Single-word language sweep used by single-word detection. */
  wordLanguageSweep: FindWordLanguagesFn;
  featureAccess?: FeatureAccessPort;
  /** Always populated by the composition root (`container.ts`) — not gated behind a feature flag. */
  videoVocabularyRepository: VideoVocabularyRepository;
  /** Curated word-picker angles authored in the admin panel. */
  wordPickerPresetRepository: WordPickerPresetRepository;
  /** Generated word-picker sets and the items in them. */
  wordPickerRunRepository: WordPickerRunRepository;
  paymentPort?: PaymentPort;
  subscriptionRepository?: SubscriptionRepository;
}
