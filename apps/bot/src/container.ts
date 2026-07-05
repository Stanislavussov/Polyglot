/**
 * Composition Root — wires all service implementations into a ServiceContainer.
 *
 * This is where adapter implementations are wired to port interfaces.
 * The container is then injected into the bot context via middleware.
 */

import {
  generateChat,
  generateObject,
  generateText,
  setAIApiKey,
  setAIGenerationDefaultsProvider,
  setAIModelPriceProvider,
  setAIRequestMetricSink,
  setAIRequestTimeoutProvider,
} from "@polyglot/adapter-ai";
// Re-export directly from adapters
import {
  aiRequestLatencyRepository,
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
  notificationRepository,
  reportedIssueRepository,
  requestTimingRepository,
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
  // The composition root owns the AI client's API key (Fable T29/A17): the
  // adapter no longer reaches for the key on its own initiative. It still falls
  // back to the OPENROUTER_API_KEY env var when nothing is injected.
  setAIApiKey(process.env.OPENROUTER_API_KEY ?? null);

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

  // The model-tuning knobs (maxTokens/temperature/frequencyPenalty/maxRetries)
  // also come from the admin-managed AI Defaults, not adapter literals (Fable
  // T21/A4). Same cached settings read as the timeout above.
  setAIGenerationDefaultsProvider(() => settings.getAIGenerationDefaults());

  // Model prices come from the single DB source (`ai_models`, admin-managed),
  // not a hardcoded registry — so a model added in the admin panel is costed
  // correctly instead of falling back to a flat default (Fable T21/A8). Read
  // through the cached settings service, same DI pattern as the timeout above.
  setAIModelPriceProvider(async (modelId) => {
    const model = (await settings.getAIModels()).find((m) => m.id === modelId);
    return model ? { costPer1kInput: model.costPer1kInput, costPer1kOutput: model.costPer1kOutput } : null;
  });

  const container: ServiceContainer = {
    userRepository,
    identityRepository,
    vocabularyRepository,
    vocabularyDictionaryRepository,
    translationTemplateRepository,
    wordReviewRepository,
    notificationRepository,
    translationRequestRepository,
    languageDetectionRepository,
    requestTimingRepository,
    reportedIssueRepository,
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
    },
    settings,
    videoVocabularyRepository,
  };
  return container;
}
