import {
  generateChat,
  generateObject,
  generateSpeech,
  generateText,
  setAIApiKey,
  setAIRequestTimeoutProvider,
  transcribeAudio,
} from "@polyglot/adapter-ai";
import {
  cardTemplateRepository,
  createContextLookup,
  createWordLanguageSweep,
  getAllLangs,
  getLang,
  getLangDisplay,
  getLangFlag,
  getLangName,
  getLangNativeName,
  getSupportedLangs,
  identityRepository,
  isKnownLang,
  isLanguageCacheLoaded,
  languageDetectionRepository,
  loadLanguageCache,
  momentumRepository,
  normalizeToIso1,
  notificationRepository,
  planFeatureAccessRepository,
  progressRepository,
  pushSubscriptionRepository,
  reportedIssueRepository,
  settingsAdapter,
  subscriptionRepository,
  translationRequestRepository,
  translationTemplateRepository,
  userRepository,
  videoVocabularyRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
  wordPickerPresetRepository,
  wordPickerRunRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import {
  createFeatureAccess,
  createMomentumService,
  createProgressService,
  MATURE_INTERVAL_DAYS,
  SettingsService,
  withReviewRecording,
} from "@polyglot/core";
import type { WebServices } from "./services.js";

/** The production wiring: the same adapters the bot's container uses, minus bot-only surfaces. */
export function createWebServices(): WebServices {
  setAIApiKey(process.env.OPENROUTER_API_KEY ?? null);
  const settings = new SettingsService(settingsAdapter);
  setAIRequestTimeoutProvider(async () => (await settings.getAIGenerationDefaults()).requestTimeoutMs);
  // Same service the bot builds, so web efforts land in the same journal under the same keys.
  const getTimezone = async (userId: number) => (await userRepository.getSettings(userId))?.timezone ?? "UTC";
  const momentumService = createMomentumService({
    momentumRepository,
    getMotivationConfig: () => settings.getMotivationConfig(),
    getTimezone,
  });
  // The bot's progress service over the same ledger, so a reward is claimed once whichever channel opens first.
  const progressService = createProgressService({
    progressRepository,
    getMotivationConfig: () => settings.getMotivationConfig(),
    getTimezone,
    countMatureWords: (userId) => vocabularyRepository.countMatureTranslations(userId, MATURE_INTERVAL_DAYS),
  });

  return {
    momentumService,
    progressService,
    userRepository,
    identityRepository,
    vocabularyRepository,
    vocabularyDictionaryRepository,
    wordReviewRepository: withReviewRecording(wordReviewRepository, () => momentumService),
    translationRequestRepository,
    languageDetectionRepository,
    translationTemplateRepository,
    subscriptionRepository,
    settings,
    featureAccess: createFeatureAccess({ settings, planFeatureAccess: planFeatureAccessRepository }),
    cardTemplateRepository,
    notificationRepository,
    pushSubscriptionRepository,
    reportedIssueRepository,
    videoVocabularyRepository,
    wordPickerPresetRepository,
    wordPickerRunRepository,
    contextLookup: createContextLookup(),
    wordLanguageSweep: createWordLanguageSweep(),
    languageCache: {
      loadLanguageCache,
      isLanguageCacheLoaded,
      getLang,
      getAllLangs,
      getSupportedLangs,
      getLangName,
      getLangNativeName,
      getLangFlag,
      getLangDisplay,
      isKnownLang,
      normalizeToIso1,
    },
    ai: {
      generateObject,
      generateText,
      generateChat,
      generateSpeech: (options) => generateSpeech(options),
      transcribe: (options) => transcribeAudio(options),
    },
  };
}
