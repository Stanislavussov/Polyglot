/**
 * Container tests — verifies DI wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "../container.js";

// Mock adapters
vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findByTelegramId: vi.fn().mockResolvedValue({ id: 1, telegramId: 123 }),
    create: vi.fn().mockResolvedValue({ id: 1, telegramId: 123 }),
    getSettings: vi.fn().mockResolvedValue({ userId: 1, interfaceLang: "en" }),
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
  translationRequestRepository: {
    logTranslationRequest: vi.fn().mockResolvedValue(1),
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    getRecentRequests: vi.fn().mockResolvedValue([]),
  },
  aiRequestLatencyRepository: {
    record: vi.fn().mockResolvedValue(undefined),
    getModelLatencySummary: vi.fn().mockResolvedValue([]),
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
      .mockResolvedValue({ defaultTime: "08:00", defaultType: "srs", inactivityDays: 14 }),
    getDictionaryConfig: vi.fn().mockResolvedValue({ flashcardLimit: 10, notificationDictLimit: 1, wordOfDayLimit: 1 }),
    getTranslationPresets: vi.fn().mockResolvedValue([]),
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
  getAvailableModels: vi.fn().mockReturnValue([]),
  estimateCost: vi.fn().mockReturnValue(0),
  setAIRequestMetricSink: vi.fn(),
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
    expect(container.translationRequestRepository).toBeDefined();
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
    expect(typeof container.ai.getAvailableModels).toBe("function");
    expect(typeof container.ai.estimateCost).toBe("function");
  });

  it("container services are callable", async () => {
    const container = createContainer();

    // Test that services can be called without throwing
    const result = await container.userRepository.findByTelegramId(123);
    expect(result).toBeDefined();
  });
});
