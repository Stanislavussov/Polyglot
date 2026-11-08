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
import { createFeatureAccess, SettingsService } from "@polyglot/core";
import type { WebServices } from "./services.js";

/** The production wiring: the same adapters the bot's container uses, minus bot-only surfaces. */
export function createWebServices(): WebServices {
  setAIApiKey(process.env.OPENROUTER_API_KEY ?? null);
  const settings = new SettingsService(settingsAdapter);
  setAIRequestTimeoutProvider(async () => (await settings.getAIGenerationDefaults()).requestTimeoutMs);

  return {
    userRepository,
    identityRepository,
    vocabularyRepository,
    vocabularyDictionaryRepository,
    wordReviewRepository,
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
