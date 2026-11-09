import type { PushSubscriptionRepository, ServiceContainer } from "@polyglot/core";

/**
 * The slice of the bot's service container the web app uses. Typed as a Pick so
 * an integration test can hand in the bot harness's container and both channels
 * run against the same repositories, settings and AI mock.
 */
export type WebServices = Pick<
  ServiceContainer,
  | "userRepository"
  | "identityRepository"
  | "vocabularyRepository"
  | "vocabularyDictionaryRepository"
  | "wordReviewRepository"
  | "translationRequestRepository"
  | "languageDetectionRepository"
  | "translationTemplateRepository"
  | "subscriptionRepository"
  | "settings"
  | "languageCache"
  | "contextLookup"
  | "wordLanguageSweep"
  | "ai"
  | "featureAccess"
  | "cardTemplateRepository"
  | "notificationRepository"
  | "reportedIssueRepository"
  | "videoVocabularyRepository"
  | "wordPickerPresetRepository"
  | "wordPickerRunRepository"
  | "momentumService"
  | "progressService"
> & {
  /** Web-only: the bot reads subscriptions straight from adapter-db when it delivers. */
  pushSubscriptionRepository: PushSubscriptionRepository;
};
