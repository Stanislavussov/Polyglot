/**
 * Composition Root — wires all service implementations into a ServiceContainer.
 *
 * This is where adapter implementations are wired to port interfaces.
 * The container is then injected into the bot context via middleware.
 */

import {
  type AIFallbackEvent,
  generateChat,
  generateObject,
  generateText,
  setAIApiKey,
  setAIFallbackObserver,
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
  planFeatureAccessRepository,
  reportedIssueRepository,
  requestTimingRepository,
  settingsAdapter,
  subscriptionRepository,
  translationRequestRepository,
  translationTemplateRepository,
  userRepository,
  videoVocabularyRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import type { AIFailover, ChatMessage, ChatOptions, GenerateOptions } from "@polyglot/core";
import { type ServiceContainer, SettingsService } from "@polyglot/core";
import type { ZodSchema } from "zod";
import { createFeatureAccess } from "./feature-access.js";
import { aiFallbackCounter } from "./metrics.js";
import { mockPaymentAdapter } from "./payment.js";
import { buildAiFailover } from "./utils/ai-model.js";
import { clampAiBudgetToOpGuard } from "./utils/long-op.js";

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

  // Fallback-model failover (Phase 2) is a QUALITY UPGRADE, not a freeze fix: the
  // per-request abort budget already bounds a hung provider and surfaces an
  // AITimeoutError; this turns that (or a 429/5xx) into a successful reply on the
  // hardcoded fallback model. Each attempt on the fallback is counted here.
  setAIFallbackObserver((event: AIFallbackEvent) =>
    aiFallbackCounter.inc({ from_model: event.fromModel, to_model: event.toModel, reason: event.reason }),
  );

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
  // so a change in the admin panel takes effect without a redeploy. The budget is
  // clamped strictly below the outer long-op guard (B8) so the adapter always
  // cancels first — an admin can't accidentally set it above the outer guard and
  // leave a still-billing call running after the user-facing guard has given up.
  setAIRequestTimeoutProvider(async () =>
    clampAiBudgetToOpGuard((await settings.getAIGenerationDefaults()).requestTimeoutMs),
  );

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

  // Resolves the fixed failover split from the same admin-managed budget the abort
  // timeout uses (B = clamped requestTimeoutMs). Every bot AI call routes through
  // this so real traffic gets failover; the model passed to each generate call is
  // the primary, and the hardcoded fallback is the second model. Returns undefined
  // when B is too small to reserve a fallback window — then the call runs unsplit.
  const resolveFailover = async (): Promise<AIFailover | undefined> => {
    const budgetMs = clampAiBudgetToOpGuard((await settings.getAIGenerationDefaults()).requestTimeoutMs);
    return buildAiFailover(budgetMs);
  };
  const ai = {
    generateObject: async <T>(prompt: string, schema: ZodSchema<T>, model: string, options?: GenerateOptions) =>
      generateObject(prompt, schema, model, { ...options, failover: await resolveFailover() }),
    generateText: async (prompt: string, model: string, options?: GenerateOptions) =>
      generateText(prompt, model, { ...options, failover: await resolveFailover() }),
    generateChat: async (messages: ChatMessage[], model: string, options?: ChatOptions) =>
      generateChat(messages, model, { ...options, failover: await resolveFailover() }),
  };

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
    ai,
    settings,
    videoVocabularyRepository,
    featureAccess: createFeatureAccess({ settings, planFeatureAccess: planFeatureAccessRepository }),
    paymentPort: mockPaymentAdapter,
    subscriptionRepository,
  };
  return container;
}
