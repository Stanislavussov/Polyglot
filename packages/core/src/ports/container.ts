/**
 * Service Container — aggregates all port interfaces into a single DI container.
 */
import type { AIPort } from "./ai.port.js";
import type { FeatureAccessPort } from "./feature-access.port.js";
import type { LanguageCachePort } from "./language-cache.port.js";
import type { NotificationRepository } from "./notification.repository.js";
import type { SettingsPort } from "./settings.port.js";
import type { TranslationRequestRepository } from "./translation-request.repository.js";
import type { TranslationTemplateRepository } from "./translation-template.repository.js";
import type { UserRepository } from "./user.repository.js";
import type { VocabularyRepository } from "./vocabulary.repository.js";
import type { VocabularyDictionaryRepository } from "./vocabulary-dictionary.repository.js";
import type { WordReviewRepository } from "./word-review.repository.js";

/**
 * Service Container — aggregates all port interfaces.
 * This is the composition root interface.
 */
export interface ServiceContainer {
  userRepository: UserRepository;
  vocabularyRepository: VocabularyRepository;
  vocabularyDictionaryRepository: VocabularyDictionaryRepository;
  translationTemplateRepository: TranslationTemplateRepository;
  wordReviewRepository: WordReviewRepository;
  notificationRepository: NotificationRepository;
  translationRequestRepository: TranslationRequestRepository;
  languageCache: LanguageCachePort;
  ai: AIPort;
  settings: SettingsPort;
  featureAccess?: FeatureAccessPort;
}
