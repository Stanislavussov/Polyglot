/**
 * Composition Root — wires all service implementations into a ServiceContainer.
 *
 * This is where adapter implementations are wired to port interfaces.
 * The container is then injected into the bot context via middleware.
 */

import {
  estimateCost,
  generateChat,
  generateObject,
  generateText,
  getAvailableModels,
  setAIRequestMetricSink,
  setAIRequestTimeoutProvider,
} from "@polyglot/adapter-ai";
// Re-export directly from adapters
import {
  aiRequestLatencyRepository,
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
  notificationRepository,
  settingsAdapter,
  translationRequestRepository,
  translationTemplateRepository,
  userRepository,
  videoVocabularyRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import { type ServiceContainer, SettingsService } from "@polyglot/core";

/**
 * Creates the full service container from adapter implementations.
 *
 * This function is called once at bot startup to wire up all dependencies.
 * The resulting container is injected into the bot context.
 */
export function createContainer(): ServiceContainer {
  setAIRequestMetricSink((log) =>
    aiRequestLatencyRepository.record({
      modelId: log.model,
      requestKind: log.requestKind,
      durationMs: log.duration_ms,
      inputTokens: log.tokens.input,
      outputTokens: log.tokens.output,
      costUsd: log.cost_usd,
      success: log.success,
      userId: log.userId,
      error: log.error,
    }),
  );

  const settings = new SettingsService(settingsAdapter);

  // The AI adapter aborts a call once it blows this budget. The value is
  // admin-managed (DB `ai.defaults`), read through the cached settings service
  // so a change in the admin panel takes effect without a redeploy.
  setAIRequestTimeoutProvider(async () => (await settings.getAIGenerationDefaults()).requestTimeoutMs);

  const container: ServiceContainer = {
    userRepository,
    vocabularyRepository,
    vocabularyDictionaryRepository,
    translationTemplateRepository,
    wordReviewRepository,
    notificationRepository,
    translationRequestRepository,
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
      getAvailableModels,
      estimateCost,
    },
    settings,
    videoVocabularyRepository,
  };
  return container;
}
