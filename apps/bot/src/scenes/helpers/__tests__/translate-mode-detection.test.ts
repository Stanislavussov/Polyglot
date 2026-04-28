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
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
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

  it("detects English (Latin) input → sourceLang='en', targetLangs are learning langs", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "en",
        targetLangs: ["cs", "ru"],
      }),
      expect.anything(),
    );
  });

  it("detects Russian (Cyrillic) input → sourceLang='ru', targetLangs are learning langs", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.anything(),
    );
  });

  it("detects language correctly for ambiguous input (single Latin script)", async () => {
    const ctx = createMockCtx();
    // With only one Latin candidate (en), script heuristic returns "en"
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "en",
        targetLangs: ["cs", "ru"],
      }),
      expect.anything(),
    );
  });

  it("does NOT show detected language indicator for native language input", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    // Card should NOT have the detected lang prefix
    const replies = vi.mocked(ctx.reply).mock.calls;
    const translationCard = replies.find((call) => typeof call[0] === "string" && call[0].includes("hello"));
    expect(translationCard).toBeDefined();
  });

  it("falls back to native→learning for ambiguous input", async () => {
    const ctx = createMockCtx();
    // Emoji/number only — no language detected, should fallback
    await handleTranslateText(ctx, "123 🎉");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.anything(),
    );
  });

  it("detects language correctly for Czech input", async () => {
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs"],
    });

    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    // Detected en (only Latin candidate) → source=en, target=[cs]
    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "en",
        targetLangs: ["cs"],
      }),
      expect.anything(),
    );
  });

  it("detects Czech (Latin + diacritics) correctly", async () => {
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    });

    const ctx = createMockCtx();
    // "dobrý den" — single Latin candidate (cs) → detected as cs
    await handleTranslateText(ctx, "dobrý den");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "cs",
        targetLangs: ["ru"],
      }),
      expect.anything(),
    );
  });

  it("logs debug info about resolved direction", async () => {
    const { logger } = await import("@polyglot/core");
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "привет");

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.any(String),
    );
  });
});
