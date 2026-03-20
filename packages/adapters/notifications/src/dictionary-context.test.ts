/**
 * Tests for notification service after context-enrichment refactor.
 *
 * After Task 15, dictionary context lookup is no longer in the notification service.
 * Context enrichment is handled by the context-enrichment layer at the translation level.
 *
 * These tests verify:
 * - SuggestedWord no longer includes dictionaryContext from the notification service
 * - NotificationServiceDeps no longer has lookupDictionaryContext
 * - Existing functionality still works without lookupDictionaryContext dep
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TopicMeta, TopicWord, LanguageTranslationEntry } from "@polyglot/core";
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
// Tests: Post context-enrichment refactor
// ─────────────────────────────────────────────

describe("createNotificationService — post context-enrichment refactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  describe("SuggestedWord without dictionaryContext", () => {
    it("returns SuggestedWord without dictionaryContext field", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).toEqual({
        original: "apple",
        emoji: "🍕",
        translations: { cs: "jablko", de: "Apfel" },
      });
      expect(result?.dictionaryContext).toBeUndefined();
    });

    it("does not include dictionaryContext key in result", async () => {
      const deps = buildDeps();
      const service = createNotificationService(deps);

      const result = await service.pickSuggestedWord(1);

      expect(result).not.toBeNull();
      expect("dictionaryContext" in result!).toBe(false);
    });
  });

  describe("backward compatibility", () => {
    it("deps no longer require lookupDictionaryContext", () => {
      // This compiles without lookupDictionaryContext — verifies the type change
      const deps: NotificationServiceDeps = {
        getTopicWords: vi.fn().mockResolvedValue([mockTopicWord]),
        getBuiltinTopics: vi.fn().mockReturnValue([mockTopicMeta]),
        getUserSettings: vi.fn().mockResolvedValue(mockUser),
      };

      // Should not throw
      const service = createNotificationService(deps);
      expect(service).toBeDefined();
    });

    it("existing callers still work", async () => {
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
  });
});
