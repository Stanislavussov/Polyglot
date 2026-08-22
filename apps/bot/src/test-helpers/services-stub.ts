/**
 * Shared `ctx.services` stub builder for bot tests (Fable T22/B7).
 *
 * Before this, a scene/helper test either hand-wrote a
 * `vi.mock("@polyglot/adapter-db")` factory (coupling the test to the
 * adapter's full export surface and its dist build — one new adapter
 * export broke every mock) or copy-pasted a bespoke `ctx.services` object
 * literal (the free-tier `getPlanLimit` stub alone was duplicated
 * verbatim across translate-mode test files). `createServicesStub` builds
 * an inert `ServiceContainer` instead: every repository method is an
 * auto-mocked `vi.fn()` that resolves to `undefined` until a test
 * overrides it, so a test only has to describe the handful of calls it
 * actually exercises.
 */
import type { ServiceContainer } from "@polyglot/core";
import { vi } from "vitest";

/** Returns a Proxy where every accessed property resolves to a memoized `vi.fn()`. */
function autoMockObject<T extends object>(): T {
  const cache = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  return new Proxy({} as T, {
    get(_target, prop) {
      const existing = cache.get(prop);
      if (existing) return existing;
      const fn = vi.fn();
      cache.set(prop, fn);
      return fn;
    },
  });
}

/** Default free-tier plan limit — matches the DB seed default. Override per test as needed. */
export const DEFAULT_PLAN_LIMIT: NonNullable<Awaited<ReturnType<ServiceContainer["settings"]["getPlanLimit"]>>> = {
  name: "free",
  label: "Free",
  translationLimit: 50,
  creditCost: 1,
  videoLimit: 3,
  videoWindow: "lifetime",
  isActive: true,
  isDefault: true,
};

/**
 * Settings stub for hand-built `ctx.services` objects: a CONFIGURED system.
 * Model resolution now reads every model id from the DB, so a context without a
 * settings port fails with AIModelNotConfiguredError instead of silently using a
 * hardcoded model — tests must describe the configured state like production does.
 */
export function createSettingsStub(): ServiceContainer["settings"] {
  return {
    getPlanLimits: vi.fn().mockResolvedValue([DEFAULT_PLAN_LIMIT]),
    getPlanLimit: vi.fn().mockResolvedValue(DEFAULT_PLAN_LIMIT),
    getAIModels: vi.fn().mockResolvedValue([]),
    getEnabledAIModels: vi.fn().mockResolvedValue([]),
    getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-5-nano"),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-5-nano"),
    getFallbackAIModel: vi.fn().mockResolvedValue(null),
    getAIGenerationDefaults: vi
      .fn()
      .mockResolvedValue({ maxTokens: 4096, temperature: 0.3, frequencyPenalty: 0.5, maxRetries: 2 }),
    getSrsConfig: vi.fn().mockResolvedValue({ minEaseFactor: 1.3, defaultEaseFactor: 2.5 }),
    getNotificationDefaults: vi
      .fn()
      .mockResolvedValue({ defaultTime: "19:00", defaultType: "srs", inactivityDays: 14, notificationTimesLimit: 12 }),
    getDictionaryConfig: vi.fn().mockResolvedValue({ flashcardLimit: 10, notificationDictLimit: 1, wordOfDayLimit: 1 }),
    getTranslationPresets: vi.fn().mockResolvedValue([]),
    getVideoVocabularyConfig: vi.fn().mockResolvedValue({
      monthlyLimit: 3,
      minPhrases: 15,
      maxPhrases: 40,
      extractionModelId: "google/gemini-3.1-flash-lite",
    }),
    // Mirrors the shipped default (on, with a working model) so hand-built contexts
    // describe the configured system the way production is configured.
    getTtsConfig: vi
      .fn()
      .mockResolvedValue({ enabled: true, modelId: "x-ai/grok-voice-tts-1.0", voice: "eve", maxChars: 200 }),
  };
}

/**
 * Build a `ServiceContainer` stub for injecting into a mock `BotContext`.
 * Pass `overrides` for the repositories/ports your test actually drives —
 * everything else is an auto-mocked no-op that never touches a real adapter.
 */
export function createServicesStub(overrides: Partial<ServiceContainer> = {}): ServiceContainer {
  const base: ServiceContainer = {
    userRepository: autoMockObject<ServiceContainer["userRepository"]>(),
    identityRepository: autoMockObject<ServiceContainer["identityRepository"]>(),
    vocabularyRepository: autoMockObject<ServiceContainer["vocabularyRepository"]>(),
    vocabularyDictionaryRepository: autoMockObject<ServiceContainer["vocabularyDictionaryRepository"]>(),
    translationTemplateRepository: autoMockObject<ServiceContainer["translationTemplateRepository"]>(),
    wordReviewRepository: autoMockObject<ServiceContainer["wordReviewRepository"]>(),
    ttsCacheRepository: autoMockObject<ServiceContainer["ttsCacheRepository"]>(),
    notificationRepository: autoMockObject<ServiceContainer["notificationRepository"]>(),
    onboardingDemoCardRepository: autoMockObject<ServiceContainer["onboardingDemoCardRepository"]>(),
    translationRequestRepository: autoMockObject<ServiceContainer["translationRequestRepository"]>(),
    languageDetectionRepository: autoMockObject<ServiceContainer["languageDetectionRepository"]>(),
    requestTimingRepository: autoMockObject<ServiceContainer["requestTimingRepository"]>(),
    reportedIssueRepository: autoMockObject<ServiceContainer["reportedIssueRepository"]>(),
    languageCache: autoMockObject<ServiceContainer["languageCache"]>(),
    ai: autoMockObject<ServiceContainer["ai"]>(),
    settings: createSettingsStub(),
    contextLookup: vi.fn().mockResolvedValue([]),
    wordLanguageSweep: vi.fn().mockResolvedValue([]),
    videoVocabularyRepository: autoMockObject<NonNullable<ServiceContainer["videoVocabularyRepository"]>>(),
    wordPickerPresetRepository: autoMockObject<ServiceContainer["wordPickerPresetRepository"]>(),
    wordPickerRunRepository: autoMockObject<ServiceContainer["wordPickerRunRepository"]>(),
  };

  return { ...base, ...overrides };
}
