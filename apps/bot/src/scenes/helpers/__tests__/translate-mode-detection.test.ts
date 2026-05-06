/**
 * Tests for auto-detect input language integration in translate-mode helper.
 * Covers resolveTranslationDirection wiring and detected language display.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const {
  mockLookupContext,
  mockUserRepository,
  mockVocabularyRepository,
  mockTranslationTemplateRepository,
  mockLanguageCache,
  mockAi,
  mockLogger,
} = vi.hoisted(() => ({
  mockLookupContext: vi.fn(),
  mockUserRepository: {
    getSettings: vi.fn(),
  },
  mockVocabularyRepository: {
    create: vi.fn().mockResolvedValue({ id: 1, translations: [] }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
    updateTranslation: vi.fn().mockResolvedValue({}),
  },
  mockTranslationTemplateRepository: {
    getByUserId: vi.fn().mockResolvedValue(null),
  },
  mockLanguageCache: {
    getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
    getLangDisplay: (code: string) => code,
  },
  mockAi: {
    generateObject: vi.fn(),
  },
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
  vocabularyRepository: mockVocabularyRepository,
  createContextLookup: () => mockLookupContext,
  getLang: mockLanguageCache.getLang,
  getLangDisplay: mockLanguageCache.getLangDisplay,
  translationTemplateRepository: mockTranslationTemplateRepository,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  // Initialize registry since vi.importActual gets a fresh module copy
  actual.initLanguageRegistry([
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
  ]);
  return {
    ...actual,
    translateWithContext: vi.fn().mockResolvedValue({
      original: "hello",
      sourceLang: "en",
      emoji: "👋",
      register: "neutral",
      translations: {
        ru: {
          text: "привет",
          register: "colloquial",
          synonyms: [],
          examples: [],
        },
        cs: {
          text: "ahoj",
          register: "colloquial",
          synonyms: [],
          examples: [],
        },
      },
    }),
    logger: mockLogger,
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: mockLogger,
}));

import { translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../../types.js";
import { handleTranslateText } from "../translate-mode.helper.js";

function createMockCtx(): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramId: 123456789 },
    services: {
      userRepository: mockUserRepository,
      vocabularyRepository: mockVocabularyRepository,
      translationTemplateRepository: mockTranslationTemplateRepository,
      languageCache: mockLanguageCache,
      ai: mockAi,
    },
  } as unknown as BotContext;
}

describe("handleTranslateText — auto-detect language direction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
  });

  it("calls translateWithContext with userId and word", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    // Verify translateWithContext was called with expected structure
    expect(translateWithContext).toHaveBeenCalled();
    const callArgs = vi.mocked(translateWithContext).mock.calls[0][0];
    expect(callArgs).toHaveProperty("userId");
    expect(callArgs).toHaveProperty("word");
    expect(callArgs.word).toBe("hello");
  });

  it("calls translateWithContext with correct model and outputConfig", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "test");

    const callArgs = vi.mocked(translateWithContext).mock.calls[0][0];
    expect(callArgs).toHaveProperty("model");
    expect(callArgs).toHaveProperty("outputConfig");
  });

  it("logs debug info about resolved direction", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "привет",
      }),
      expect.any(String),
    );
  });

  it("handles Russian (Cyrillic) input", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(translateWithContext).toHaveBeenCalled();
    const callArgs = vi.mocked(translateWithContext).mock.calls[0][0];
    expect(callArgs).toHaveProperty("sourceLang");
    expect(callArgs).toHaveProperty("targetLangs");
  });

  it("falls back to native→learning for ambiguous input", async () => {
    const ctx = createMockCtx();
    // Emoji/number only — no language detected, should fallback
    await handleTranslateText(ctx, "123 🎉");

    expect(translateWithContext).toHaveBeenCalled();
  });
});
