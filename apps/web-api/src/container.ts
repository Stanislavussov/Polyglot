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
  planFeatureAccessRepository,
  settingsAdapter,
  subscriptionRepository,
  translationRequestRepository,
  translationTemplateRepository,
  userRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import { createFeatureAccess, createMomentumService, SettingsService, withReviewRecording } from "@polyglot/core";
import type { WebServices } from "./services.js";

/** The production wiring: the same adapters the bot's container uses, minus bot-only surfaces. */
export function createWebServices(): WebServices {
  setAIApiKey(process.env.OPENROUTER_API_KEY ?? null);
  const settings = new SettingsService(settingsAdapter);
  setAIRequestTimeoutProvider(async () => (await settings.getAIGenerationDefaults()).requestTimeoutMs);
  // Same service the bot builds, so web efforts land in the same journal under the same keys.
  const momentumService = createMomentumService({
    momentumRepository,
    getMotivationConfig: () => settings.getMotivationConfig(),
    getTimezone: async (userId) => (await userRepository.getSettings(userId))?.timezone ?? "UTC",
  });

  return {
    momentumService,
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
