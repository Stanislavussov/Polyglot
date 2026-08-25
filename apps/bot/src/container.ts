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
  generateSpeech,
  generateText,
  setAIApiKey,
  setAICircuitBreakerEnabled,
  setAIFallbackObserver,
  setAIGenerationDefaultsProvider,
  setAIModelPriceProvider,
  setAIRequestMetricSink,
  setAIRequestTimeoutProvider,
  transcribeAudio,
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
  mentorMessageRepository,
  normalizeToIso1,
  notificationRepository,
  onboardingDemoCardRepository,
  planFeatureAccessRepository,
  reportedIssueRepository,
  requestTimingRepository,
  settingsAdapter,
  subscriptionRepository,
  translationRequestRepository,
  translationTemplateRepository,
  ttsCacheRepository,
  userRepository,
  videoVocabularyRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
  wordPickerPresetRepository,
  wordPickerRunRepository,
  wordReviewRepository,
} from "@polyglot/adapter-db";
import type {
  AICircuitEvent,
  AIFailover,
  ChatMessage,
  ChatOptions,
  GenerateOptions,
  SpeechOptions,
  TranscribeOptions,
} from "@polyglot/core";
import { type ServiceContainer, SettingsService, setAICircuitObserver } from "@polyglot/core";
import type { ZodSchema } from "zod";
import { createFeatureAccess } from "./feature-access.js";
import { aiCircuitStateGauge, aiCircuitTransitionsCounter, aiFallbackCounter } from "./metrics.js";
import { mockPaymentAdapter } from "./payment.js";
import { buildAiFailover, resolveFallbackAIModel } from "./utils/ai-model.js";
import { clampAiBudgetToOpGuard } from "./utils/long-op.js";

/**
 * Values that disable `AI_CIRCUIT_BREAKER_ENABLED` (the Phase 3 rollback
 * kill-switch). Deliberately permissive — an operator reaching for this under
 * pressure may reasonably set `0`/`off`/`no`/`FALSE`, and the switch must not
 * silently stay ON just because the value wasn't the exact string `"false"`.
 * Anything else (including unset) stays default-ON.
 */
const DISABLE_VALUES = new Set(["false", "0", "off", "no"]);

/** True unless the env var is set to a recognized "disable" value (case/whitespace-insensitive). */
function isCircuitBreakerEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return !DISABLE_VALUES.has(raw.trim().toLowerCase());
}

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

  // Per-model circuit breaker (Phase 3) gates the same failover path so a provider
  // that is already failing is not hammered. Default-closed and behavior-neutral —
  // it only changes behavior after repeated retriable failures trip it open. The
  // AI_CIRCUIT_BREAKER_ENABLED kill-switch (default ON) disables the gate entirely
  // without a logic redeploy — the plan's rollback path. Each transition drives a
  // gauge (0=closed, 1=half-open, 2=open) and a transitions counter for alerting.
  setAICircuitBreakerEnabled(isCircuitBreakerEnabled(process.env.AI_CIRCUIT_BREAKER_ENABLED));
  setAICircuitObserver((event: AICircuitEvent) => {
    const stateValue = event.state === "open" ? 2 : event.state === "half-open" ? 1 : 0;
    aiCircuitStateGauge.set({ model: event.model }, stateValue);
    aiCircuitTransitionsCounter.inc({ model: event.model, to_state: event.state });
  });

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

  // Resolves the failover split from admin-managed settings: the budget from the
  // same clamped requestTimeoutMs the abort timeout uses, and the second model from
  // the DB `ai_models.is_fallback` flag. Every bot AI call routes through this so
  // real traffic gets failover; the model passed to each generate call is the
  // primary. Returns undefined when B is too small to reserve a fallback window, or
  // when no fallback model is configured — then the call runs unsplit.
  const resolveFailover = async (): Promise<AIFailover | undefined> => {
    const [defaults, fallbackModel] = await Promise.all([
      settings.getAIGenerationDefaults(),
      resolveFallbackAIModel(settings),
    ]);
    return buildAiFailover(clampAiBudgetToOpGuard(defaults.requestTimeoutMs), fallbackModel);
  };
  const ai = {
    generateObject: async <T>(prompt: string, schema: ZodSchema<T>, model: string, options?: GenerateOptions) =>
      generateObject(prompt, schema, model, { ...options, failover: await resolveFailover() }),
    generateText: async (prompt: string, model: string, options?: GenerateOptions) =>
      generateText(prompt, model, { ...options, failover: await resolveFailover() }),
    generateChat: async (messages: ChatMessage[], model: string, options?: ChatOptions) =>
      generateChat(messages, model, { ...options, failover: await resolveFailover() }),
    // No failover split: a failed pronunciation is a toast, not a broken card, and
    // the split machinery is shaped around the completion endpoints (Task 77).
    generateSpeech: (options: SpeechOptions) => generateSpeech(options),
    // Same reasoning as generateSpeech: no failover split. A failed transcription
    // is a "couldn't hear that" reply, and the split machinery is shaped around
    // the completion endpoints.
    transcribe: (options: TranscribeOptions) => transcribeAudio(options),
  };

  const container: ServiceContainer = {
    userRepository,
    identityRepository,
    vocabularyRepository,
    vocabularyDictionaryRepository,
    translationTemplateRepository,
    wordReviewRepository,
    notificationRepository,
    mentorMessageRepository,
    onboardingDemoCardRepository,
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
    wordPickerPresetRepository,
    wordPickerRunRepository,
    ttsCacheRepository,
    featureAccess: createFeatureAccess({ settings, planFeatureAccess: planFeatureAccessRepository }),
    paymentPort: mockPaymentAdapter,
    subscriptionRepository,
  };
  return container;
}
