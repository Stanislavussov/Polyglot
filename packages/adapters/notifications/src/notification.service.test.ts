import type { LanguageTranslationEntry, TopicMeta, TopicWord } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationServiceDeps, UserForNotification, VocabEntry } from "./types.js";

// ─────────────────────────────────────────────
// Mock logger (hoisted to avoid TDZ issues)
// ─────────────────────────────────────────────

const { mockLogger, mockChild } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockChild: vi.fn(() => mockLogger),
}));

vi.mock("@polyglot/core", () => ({
  getLogger: vi.fn(() => ({
    info: mockLogger.info,
    warn: mockLogger.warn,
    error: mockLogger.error,
    child: mockChild,
  })),
}));

import { createNotificationService } from "./notification.service.js";

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

const mockUser: UserForNotification = {
  id: 1,
  telegramId: 12345,
  timezone: "Europe/Prague",
  nativeLang: "en",
  learningLangs: ["cs", "de"],
};

const mockTopicMeta: TopicMeta = {
  id: "food",
  name: "Food & Cooking",
  emoji: "🍕",
  wordCount: 3,
};

const makeLangEntry = (text: string): LanguageTranslationEntry => ({
  text,
  synonyms: [{ text: `${text}-syn` }],
  examples: [{ context: "neutral", target: text }],
});

const mockTopicWord: TopicWord = {
  original: "apple",
  translations: {
    cs: makeLangEntry("jablko"),
    de: makeLangEntry("Apfel"),
  },
};

const mockTopicWordPartial: TopicWord = {
  original: "bread",
  translations: {
    cs: makeLangEntry("chléb"),
    // de is missing — needs partial regeneration
  },
};

// ─────────────────────────────────────────────
// Helper to build deps
// ─────────────────────────────────────────────

function buildDeps(overrides: Partial<NotificationServiceDeps> = {}): NotificationServiceDeps {
  return {
    getTopicWords: vi.fn().mockResolvedValue([mockTopicWord]),
    regenerateTopicWord: vi.fn().mockResolvedValue(makeLangEntry("regenerated")),
    getBuiltinTopics: vi.fn().mockReturnValue([mockTopicMeta]),
    getUserSettings: vi.fn().mockResolvedValue(mockUser),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe("createNotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fix random to always pick first element
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  describe("pickSuggestedWord — happy path", () => {
    it("returns a SuggestedWord with translations for all learning langs", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: {
          cs: "jablko",
          de: "Apfel",
        },
        source: "suggested",
      });
    });

    it("calls getUserSettings with the correct userId", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(42);

      expect(deps.getUserSettings).toHaveBeenCalledWith(42);
    });

    it("calls getTopicWords with user's nativeLang and learningLangs", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(deps.getTopicWords).toHaveBeenCalledWith("food", "en", ["cs", "de"]);
    });

    it("uses topic emoji in the suggested word", async () => {
      const travelMeta: TopicMeta = { id: "travel", name: "Travel", emoji: "✈️", wordCount: 5 };
      const deps = buildDeps({
        getBuiltinTopics: vi.fn().mockReturnValue([travelMeta]),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result?.emoji).toBe("✈️");
    });
  });

  describe("pickSuggestedWord — partial regeneration", () => {
    it("regenerates missing language translation", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWordPartial]),
        regenerateTopicWord: vi.fn().mockResolvedValue(makeLangEntry("Brot")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "bread",
        emoji: "🍕",
        translations: {
          cs: "chléb",
          de: "Brot",
        },
        source: "suggested",
      });
    });

    it("calls regenerateTopicWord with correct args for missing lang", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWordPartial]),
      });
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(deps.regenerateTopicWord).toHaveBeenCalledWith("food", "bread", "en", "de");
    });

    it("does not call regenerateTopicWord when all langs present", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(deps.regenerateTopicWord).not.toHaveBeenCalled();
    });

    it("logs info when partial regeneration succeeds", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWordPartial]),
      });
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          original: "bread",
          lang: "de",
          topicId: "food",
        }),
        expect.stringContaining("Partially regenerated"),
      );
    });
  });

  describe("pickSuggestedWord — error handling", () => {
    it("returns null when user not found", async () => {
      const deps = buildDeps({
        getUserSettings: vi.fn().mockResolvedValue(null),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(999);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("returns null when user has no learning langs", async () => {
      const deps = buildDeps({
        getUserSettings: vi.fn().mockResolvedValue({ ...mockUser, learningLangs: [] }),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toBeNull();
    });

    it("returns null when no built-in topics available", async () => {
      const deps = buildDeps({
        getBuiltinTopics: vi.fn().mockReturnValue([]),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("returns null when topic has no words", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([]),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toBeNull();
    });

    it("returns null when getTopicWords throws", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockRejectedValue(new Error("DB down")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: "food" }),
        expect.stringContaining("Failed to get topic words"),
      );
    });

    it("skips lang when regenerateTopicWord is not provided", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWordPartial]),
        regenerateTopicWord: undefined,
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      // Only cs is present; de is skipped
      expect(result).toEqual({
        original: "bread",
        emoji: "🍕",
        translations: { cs: "chléb" },
        source: "suggested",
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ lang: "de" }),
        expect.stringContaining("regenerateTopicWord not available"),
      );
    });

    it("continues on regeneration error — logs and skips the lang", async () => {
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWordPartial]),
        regenerateTopicWord: vi.fn().mockRejectedValue(new Error("AI timeout")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      // Only cs is present; de failed regeneration
      expect(result).toEqual({
        original: "bread",
        emoji: "🍕",
        translations: { cs: "chléb" },
        source: "suggested",
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ original: "bread", lang: "de" }),
        expect.stringContaining("Partial regeneration failed"),
      );
    });

    it("returns null when all translations fail (none resolved)", async () => {
      const wordAllMissing: TopicWord = {
        original: "butter",
        translations: {},
      };
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue([wordAllMissing]),
        regenerateTopicWord: vi.fn().mockRejectedValue(new Error("AI error")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ original: "butter" }),
        expect.stringContaining("No translations available"),
      );
    });
  });

  describe("pickSuggestedWord — randomization", () => {
    it("picks a different word when random returns higher value", async () => {
      const words: TopicWord[] = [
        { original: "apple", translations: { cs: makeLangEntry("jablko"), de: makeLangEntry("Apfel") } },
        { original: "banana", translations: { cs: makeLangEntry("banán"), de: makeLangEntry("Banane") } },
      ];
      const deps = buildDeps({
        getTopicWords: vi.fn().mockResolvedValue(words),
      });
      const service = createNotificationService(deps);

      // Pick second word (index 1 out of 2 → random must return 0.5..0.99)
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const result = await service.pickSuggestedWord(1);

      expect(result?.original).toBe("banana");
    });

    it("picks a different topic when multiple are available", async () => {
      const topics: TopicMeta[] = [
        { id: "food", name: "Food", emoji: "🍕", wordCount: 3 },
        { id: "travel", name: "Travel", emoji: "✈️", wordCount: 5 },
      ];
      const deps = buildDeps({
        getBuiltinTopics: vi.fn().mockReturnValue(topics),
      });
      const service = createNotificationService(deps);

      // Pick second topic (index 1 out of 2)
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const result = await service.pickSuggestedWord(1);

      expect(deps.getTopicWords).toHaveBeenCalledWith("travel", "en", ["cs", "de"]);
      expect(result?.emoji).toBe("✈️");
    });
  });

  describe("pickSuggestedWord — source field", () => {
    it("includes source: 'suggested' in the result", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result?.source).toBe("suggested");
    });
  });
});

// ─────────────────────────────────────────────
// pickDictionaryWord tests
// ─────────────────────────────────────────────

describe("pickDictionaryWord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockVocabEntries: VocabEntry[] = [
    {
      id: 10,
      original: "house",
      emoji: "🏠",
      createdAt: new Date("2025-01-01"),
      translations: [
        { targetLangId: 1, text: "dům" },
        { targetLangId: 2, text: "Haus" },
      ],
    },
    {
      id: 20,
      original: "car",
      emoji: "🚗",
      createdAt: new Date("2025-01-05"),
      translations: [
        { targetLangId: 1, text: "auto" },
        { targetLangId: 2, text: "Auto" },
      ],
    },
    {
      id: 30,
      original: "book",
      emoji: null,
      createdAt: new Date("2025-01-10"),
      translations: [{ targetLangId: 1, text: "kniha" }],
    },
  ];

  const mockGetLangCode = vi.fn((id: number) => {
    const map: Record<number, string> = { 1: "cs", 2: "de" };
    return map[id];
  });

  function buildDictDeps(overrides: Partial<NotificationServiceDeps> = {}): NotificationServiceDeps {
    return {
      getTopicWords: vi.fn().mockResolvedValue([]),
      getBuiltinTopics: vi.fn().mockReturnValue([]),
      getUserSettings: vi.fn().mockResolvedValue(mockUser),
      getUserVocabulary: vi.fn().mockResolvedValue(mockVocabEntries),
      getLangCode: mockGetLangCode,
      ...overrides,
    };
  }

  describe("happy path", () => {
    it("returns a random word from candidates", async () => {
      const deps = buildDictDeps();
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(["house", "car", "book"]).toContain(result?.original);
    });

    it("includes translations resolved via getLangCode", async () => {
      const deps = buildDictDeps();
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.translations).toEqual({ cs: "dům", de: "Haus" });
    });

    it("uses entry emoji when available", async () => {
      const deps = buildDictDeps();
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.emoji).toBe("🏠");
    });

    it("falls back to 📖 emoji when entry has no emoji", async () => {
      const singleEntry: VocabEntry[] = [
        {
          id: 30,
          original: "book",
          emoji: null,
          createdAt: new Date("2025-01-10"),
          translations: [{ targetLangId: 1, text: "kniha" }],
        },
      ];
      const deps = buildDictDeps({
        getUserVocabulary: vi.fn().mockResolvedValue(singleEntry),
      });
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.emoji).toBe("📖");
    });

    it("includes source: 'srs' in the result", async () => {
      const deps = buildDictDeps();
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result?.source).toBe("srs");
    });
  });

  describe("edge cases", () => {
    it("returns null when user has no vocabulary", async () => {
      const deps = buildDictDeps({
        getUserVocabulary: vi.fn().mockResolvedValue([]),
      });
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
    });

    it("returns null when entry has no resolvable translations", async () => {
      const entryWithUnknownLang: VocabEntry[] = [
        {
          id: 99,
          original: "mystery",
          emoji: "❓",
          createdAt: new Date(),
          translations: [{ targetLangId: 999, text: "unknown" }],
        },
      ];
      const deps = buildDictDeps({
        getUserVocabulary: vi.fn().mockResolvedValue(entryWithUnknownLang),
        getLangCode: vi.fn().mockReturnValue(undefined),
      });
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
    });

    it("returns null when deps are missing", async () => {
      const deps = buildDictDeps({
        getUserVocabulary: undefined,
        getLangCode: undefined,
      });
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        expect.stringContaining("missing deps"),
      );
    });
  });

  describe("error handling", () => {
    it("returns null when getUserVocabulary throws", async () => {
      const deps = buildDictDeps({
        getUserVocabulary: vi.fn().mockRejectedValue(new Error("DB error")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickDictionaryWord(1);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1 }),
        expect.stringContaining("failed to get user vocabulary"),
      );
    });
  });
});
