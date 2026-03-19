import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TopicMeta, TopicWord, LanguageTranslationEntry, DictionaryContext } from "@polyglot/core";
import type { NotificationServiceDeps, UserForNotification } from "./types.js";

// ─────────────────────────────────────────────
// Mock logger (hoisted to avoid TDZ issues)
// ─────────────────────────────────────────────

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@polyglot/infra", () => ({
  logger: mockLogger,
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
  cefr: "B1",
  register: "neutral",
  synonyms: [{ text: `${text}-syn`, register: "neutral" }],
  examples: [{ context: "formal", target: text, native: "example" }],
});

const mockTopicWord: TopicWord = {
  original: "apple",
  translations: {
    cs: makeLangEntry("jablko"),
    de: makeLangEntry("Apfel"),
  },
};

const mockDictionaryContext: DictionaryContext = {
  word: "apple",
  pos: "noun",
  glosses: ["A common round fruit", "The tree that bears such fruit"],
  formTags: ["canonical"],
  langCode: "en",
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
// Tests: Dictionary Context Integration
// ─────────────────────────────────────────────

describe("createNotificationService — dictionary context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  describe("happy path", () => {
    it("includes dictionaryContext when lookupDictionaryContext returns a result", async () => {
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockResolvedValue(mockDictionaryContext),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: { cs: "jablko", de: "Apfel" },
        dictionaryContext: mockDictionaryContext,
      });
    });

    it("calls lookupDictionaryContext with word original and user nativeLang", async () => {
      const lookupFn = vi.fn().mockResolvedValue(mockDictionaryContext);
      const deps = buildDeps({ lookupDictionaryContext: lookupFn });
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(lookupFn).toHaveBeenCalledWith("apple", "en");
    });

    it("logs info when dictionary context is found", async () => {
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockResolvedValue(mockDictionaryContext),
      });
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          original: "apple",
          pos: "noun",
          glosses: 2,
        }),
        expect.stringContaining("Dictionary context found"),
      );
    });

    it("includes dictionary context with phrase pos and multiple glosses", async () => {
      const phraseContext: DictionaryContext = {
        word: "apple",
        pos: "phrase",
        glosses: ["fruit", "technology company", "the apple of one's eye"],
        langCode: "en",
      };
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockResolvedValue(phraseContext),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result?.dictionaryContext).toEqual(phraseContext);
      expect(result?.dictionaryContext?.glosses).toHaveLength(3);
    });
  });

  describe("no context available", () => {
    it("omits dictionaryContext when lookupDictionaryContext returns null", async () => {
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockResolvedValue(null),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: { cs: "jablko", de: "Apfel" },
      });
      expect(result?.dictionaryContext).toBeUndefined();
    });

    it("omits dictionaryContext when lookupDictionaryContext is not provided", async () => {
      const deps = buildDeps({ lookupDictionaryContext: undefined });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: { cs: "jablko", de: "Apfel" },
      });
      expect(result?.dictionaryContext).toBeUndefined();
    });

    it("does not call lookupDictionaryContext when dep is not provided", async () => {
      const deps = buildDeps({ lookupDictionaryContext: undefined });
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      // No function to call — nothing should fail
      expect(deps.lookupDictionaryContext).toBeUndefined();
    });
  });

  describe("fail-open error handling", () => {
    it("returns result without dictionaryContext when lookup throws", async () => {
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: { cs: "jablko", de: "Apfel" },
      });
      expect(result?.dictionaryContext).toBeUndefined();
    });

    it("logs error when lookup throws but continues", async () => {
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockRejectedValue(new Error("DB timeout")),
      });
      const service = createNotificationService(deps);

      await service.pickSuggestedWord(1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ original: "apple" }),
        expect.stringContaining("Dictionary context lookup failed"),
      );
    });

    it("does not stop translation flow when lookup fails", async () => {
      const deps = buildDeps({
        lookupDictionaryContext: vi.fn().mockRejectedValue(new Error("Network error")),
      });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      // Translation data is still present
      expect(result?.translations).toEqual({ cs: "jablko", de: "Apfel" });
      expect(result?.original).toBe("apple");
    });
  });

  describe("backward compatibility", () => {
    it("existing callers without lookupDictionaryContext still work", async () => {
      // Simulates old-style deps without the new optional dep
      const deps: NotificationServiceDeps = {
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWord]),
        getBuiltinTopics: vi.fn().mockReturnValue([mockTopicMeta]),
        getUserSettings: vi.fn().mockResolvedValue(mockUser),
      };
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: { cs: "jablko", de: "Apfel" },
      });
    });

    it("SuggestedWord without dictionaryContext has no undefined key", async () => {
      const deps = buildDeps({ lookupDictionaryContext: undefined });
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).not.toBeNull();
      expect("dictionaryContext" in result!).toBe(false);
    });
  });
});
