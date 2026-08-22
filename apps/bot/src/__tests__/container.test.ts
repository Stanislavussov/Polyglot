/**
 * Container tests — verifies DI wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "../container.js";

// Mock adapters
vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findById: vi.fn().mockResolvedValue({ id: 1 }),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    getSettings: vi.fn().mockResolvedValue({ userId: 1, interfaceLang: "en" }),
  },
  identityRepository: {
    resolveUserId: vi.fn().mockResolvedValue(1),
    findExternalId: vi.fn().mockResolvedValue("123"),
    linkIdentity: vi.fn().mockResolvedValue(undefined),
  },
  vocabularyRepository: {
    findByUser: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
  },
  vocabularyDictionaryRepository: {
    getOrCreateDefault: vi.fn().mockResolvedValue({ id: 1, name: "My Words" }),
    addEntryToDefault: vi.fn().mockResolvedValue({ id: 1, name: "My Words" }),
  },
  translationTemplateRepository: {
    getByUserId: vi.fn().mockResolvedValue(null),
  },
  wordReviewRepository: {
    logReview: vi.fn().mockResolvedValue(undefined),
    getReviewCounts: vi.fn().mockResolvedValue(new Map()),
  },
  notificationRepository: {
    getUsersForWindow: vi.fn().mockResolvedValue([]),
    getInactiveUsers: vi.fn().mockResolvedValue([]),
    disableNotifications: vi.fn().mockResolvedValue(undefined),
  },
  onboardingDemoCardRepository: {
    findActive: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    hasCached: vi.fn().mockResolvedValue(false),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
  translationRequestRepository: {
    logTranslationRequest: vi.fn().mockResolvedValue(1),
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    getRecentRequests: vi.fn().mockResolvedValue([]),
  },
  languageDetectionRepository: {
    record: vi.fn().mockResolvedValue(undefined),
  },
  requestTimingRepository: {
    record: vi.fn().mockResolvedValue(undefined),
  },
  reportedIssueRepository: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
  },
  planFeatureAccessRepository: {
    findFeaturesForPlan: vi.fn().mockResolvedValue([]),
    setFeaturesForPlan: vi.fn().mockResolvedValue(undefined),
  },
  subscriptionRepository: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findActiveByUser: vi.fn().mockResolvedValue(null),
    findExpired: vi.fn().mockResolvedValue([]),
    extend: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  },
  ttsCacheRepository: {
    find: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    touch: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  createContextLookup: vi.fn(() => vi.fn().mockResolvedValue([])),
  createWordLanguageSweep: vi.fn(() => vi.fn().mockResolvedValue([])),
  aiRequestLatencyRepository: {
    record: vi.fn().mockResolvedValue(undefined),
    getModelLatencySummary: vi.fn().mockResolvedValue([]),
  },
  videoVocabularyRepository: {
    createProcess: vi.fn().mockResolvedValue({ id: 1 }),
    findProcessById: vi.fn().mockResolvedValue(null),
    findProcessByUserAndVideo: vi.fn().mockResolvedValue(null),
    findProcessesByUser: vi.fn().mockResolvedValue([]),
    countProcessesByUser: vi.fn().mockResolvedValue(0),
    getMonthlyUsageCount: vi.fn().mockResolvedValue(0),
    savePhrases: vi.fn().mockResolvedValue(undefined),
    findPhrasesByProcess: vi.fn().mockResolvedValue([]),
    countPhrasesByProcess: vi.fn().mockResolvedValue(0),
    findPhraseById: vi.fn().mockResolvedValue(null),
    markPhraseSaved: vi.fn().mockResolvedValue(undefined),
    findCachedTranscript: vi.fn().mockResolvedValue(null),
    cacheTranscript: vi.fn().mockResolvedValue(undefined),
    updateProcessStatus: vi.fn().mockResolvedValue(undefined),
  },
  wordPickerPresetRepository: {
    findById: vi.fn().mockResolvedValue(null),
    findActiveForLangs: vi.fn().mockResolvedValue([]),
  },
  wordPickerRunRepository: {
    createRun: vi.fn().mockResolvedValue({ id: 1 }),
    saveItems: vi.fn().mockResolvedValue([]),
    findRunById: vi.fn().mockResolvedValue(null),
    findItemsByRun: vi.fn().mockResolvedValue([]),
    findItemById: vi.fn().mockResolvedValue(null),
    findUnsavedItemsByRun: vi.fn().mockResolvedValue([]),
    markItemSaved: vi.fn().mockResolvedValue(undefined),
    findWordsShownTo: vi.fn().mockResolvedValue([]),
  },
  settingsAdapter: {
    getPlanLimits: vi.fn().mockResolvedValue([]),
    getPlanLimit: vi.fn().mockResolvedValue(null),
    getAIModels: vi.fn().mockResolvedValue([]),
    getEnabledAIModels: vi.fn().mockResolvedValue([]),
    getEnabledAIModelsForPlan: vi.fn().mockResolvedValue([]),
    getDefaultAIModel: vi.fn().mockResolvedValue(null),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue(null),
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
  },
  loadLanguageCache: vi.fn().mockResolvedValue(undefined),
  isLanguageCacheLoaded: vi.fn().mockReturnValue(true),
  getLang: vi.fn().mockReturnValue({
    id: 1,
    code: "en",
    name: "English",
    nativeName: "English",
    flag: "🇬🇧",
    isSupported: true,
    localizedNames: null,
  }),
  getAllLangs: vi.fn().mockReturnValue([{ id: 1, code: "en", name: "English" }]),
  getSupportedLangs: vi.fn().mockReturnValue([{ id: 1, code: "en", name: "English" }]),
  getLangName: vi.fn().mockReturnValue("English"),
  getLangNativeName: vi.fn().mockReturnValue("English"),
  getLangFlag: vi.fn().mockReturnValue("🇬🇧"),
  getLangDisplay: vi.fn().mockReturnValue("🇬🇧 English"),
  isKnownLang: vi.fn().mockReturnValue(true),
  normalizeToIso1: vi.fn().mockImplementation((lang) => lang),
}));

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn().mockResolvedValue({}),
  generateText: vi.fn().mockResolvedValue("test"),
  generateChat: vi.fn().mockResolvedValue("test"),
  setAIApiKey: vi.fn(),
  setAICircuitBreakerEnabled: vi.fn(),
  setAIFallbackObserver: vi.fn(),
  setAIGenerationDefaultsProvider: vi.fn(),
  setAIModelPriceProvider: vi.fn(),
  setAIRequestMetricSink: vi.fn(),
  setAIRequestTimeoutProvider: vi.fn(),
}));

describe("createContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a container with all services", () => {
    const container = createContainer();

    // Verify all services are present
    expect(container).toBeDefined();
    expect(container.userRepository).toBeDefined();
    expect(container.vocabularyRepository).toBeDefined();
    expect(container.translationTemplateRepository).toBeDefined();
    expect(container.wordReviewRepository).toBeDefined();
    expect(container.notificationRepository).toBeDefined();
    expect(container.onboardingDemoCardRepository).toBeDefined();
    expect(container.translationRequestRepository).toBeDefined();
    expect(container.languageDetectionRepository).toBeDefined();
    expect(container.requestTimingRepository).toBeDefined();
    expect(container.reportedIssueRepository).toBeDefined();
    expect(typeof container.contextLookup).toBe("function");
    expect(typeof container.wordLanguageSweep).toBe("function");
    expect(container.languageCache).toBeDefined();
    expect(container.ai).toBeDefined();
    expect(container.settings).toBeDefined();
  });

  it("container has languageCache methods", () => {
    const container = createContainer();

    expect(typeof container.languageCache.loadLanguageCache).toBe("function");
    expect(typeof container.languageCache.isLanguageCacheLoaded).toBe("function");
    expect(typeof container.languageCache.getLang).toBe("function");
    expect(typeof container.languageCache.getAllLangs).toBe("function");
    expect(typeof container.languageCache.getSupportedLangs).toBe("function");
  });

  it("container has AI methods", () => {
    const container = createContainer();

    expect(typeof container.ai.generateObject).toBe("function");
    expect(typeof container.ai.generateText).toBe("function");
    expect(typeof container.ai.generateChat).toBe("function");
  });

  it("container services are callable", async () => {
    const container = createContainer();

    // Test that services can be called without throwing
    const result = await container.userRepository.findById(1);
    expect(result).toBeDefined();
  });
});
