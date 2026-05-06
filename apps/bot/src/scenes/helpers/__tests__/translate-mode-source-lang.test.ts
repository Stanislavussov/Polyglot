/**
 * Tests for nextSourceLang integration in translate-mode helper.
 * Covers explicit source language override (Task 17) and fallback to auto-detect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules before imports
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
    updateLastSourceLang: vi.fn().mockResolvedValue(undefined),
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
  translationTemplateRepository: mockTranslationTemplateRepository,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  actual.initLanguageRegistry([
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
  ]);
  return {
    ...actual,
    translateWithContext: vi.fn().mockResolvedValue({
      original: "test",
      sourceLang: "cs",
      emoji: "🏠",
      register: "neutral",
      translations: {
        ru: { text: "тест", register: "neutral", synonyms: [], examples: [] },
        en: { text: "test", register: "neutral", synonyms: [], examples: [] },
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
import { handleSaveCallback, handleSkipCallback, handleTranslateText } from "../translate-mode.helper.js";

function createMockCtx(nextSourceLang?: string | null): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: nextSourceLang ?? null,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramTelegramId: 123456789 },
    services: {
      userRepository: mockUserRepository,
      vocabularyRepository: mockVocabularyRepository,
      translationTemplateRepository: mockTranslationTemplateRepository,
      languageCache: mockLanguageCache,
      ai: mockAi,
    },
  } as unknown as BotContext;
}

describe("handleTranslateText — nextSourceLang integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
  });

  it("uses explicit source when nextSourceLang='cs'", async () => {
    const ctx = createMockCtx("cs");
    await handleTranslateText(ctx, "dům");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "cs",
        targetLangs: ["ru", "en"],
      }),
      expect.anything(),
    );
  });

  it("uses explicit source when nextSourceLang='ru' (native lang)", async () => {
    const ctx = createMockCtx("ru");
    await handleTranslateText(ctx, "привет");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.anything(),
    );
  });

  it("uses explicit source when nextSourceLang='en'", async () => {
    const ctx = createMockCtx("en");
    await handleTranslateText(ctx, "house");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "en",
        targetLangs: ["ru", "cs"],
      }),
      expect.anything(),
    );
  });

  it("falls back to auto-detect when nextSourceLang is null", async () => {
    const ctx = createMockCtx(null);
    await handleTranslateText(ctx, "привет");

    // Cyrillic input → detected as Russian → standard direction
    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
      }),
      expect.anything(),
    );
  });

  it("resets nextSourceLang and falls back when source is invalid", async () => {
    const ctx = createMockCtx("de"); // German not in user config
    await handleTranslateText(ctx, "hallo");

    expect(ctx.session.nextSourceLang).toBeNull();
  });

  it("logs nextSourceLang in debug output when explicitly set", async () => {
    const ctx = createMockCtx("cs");
    await handleTranslateText(ctx, "dům");

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        nextSourceLang: "cs",
      }),
      expect.any(String),
    );
  });
});

describe("handleSaveCallback — FEAT-30 save flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
  });

  it("edits card in place with savedToDict text and post-save keyboard", async () => {
    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {
        cs: { text: "test-cs", register: "neutral", synonyms: [], examples: [] },
        en: { text: "test-en", register: "neutral", synonyms: [], examples: [] },
      },
    } as any;
    mockVocabularyRepository.create = vi.fn().mockResolvedValue({ id: 42 });
    mockVocabularyRepository.findByOriginalAndSource = vi.fn().mockResolvedValue(null);

    await handleSaveCallback(ctx);

    expect(mockVocabularyRepository.create).toHaveBeenCalled();
    expect(ctx.session.savedWordId).toBe(42);
    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("test-cs"), expect.any(Object));
  });

  it("sets savedWordId in session after save", async () => {
    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {
        cs: { text: "test-cs", register: "neutral", synonyms: [], examples: [] },
      },
    } as any;
    mockVocabularyRepository.create = vi.fn().mockResolvedValue({ id: 99 });

    await handleSaveCallback(ctx);

    expect(ctx.session.savedWordId).toBe(99);
  });
});

describe("handleSkipCallback — source lang menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
  });

  it("shows source language menu after skip (3+ langs)", async () => {
    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {
        cs: { text: "test-cs", register: "neutral", synonyms: [], examples: [] },
        en: { text: "test-en", register: "neutral", synonyms: [], examples: [] },
      },
    } as any;

    await handleSkipCallback(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Send"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );
  });

  it("shows plain hint after skip when only 2 languages", async () => {
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    });

    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {
        en: { text: "test-en", register: "neutral", synonyms: [], examples: [] },
      },
    } as any;

    await handleSkipCallback(ctx);

    // With only 2 languages (native + 1 learning), keyboard should not be shown
    // Check that ctx.reply was called with just a string (no second argument with reply_markup)
    const replyCalls = vi.mocked(ctx.reply).mock.calls;
    const hintCall = replyCalls.find((call) => typeof call[0] === "string" && call[0].includes("Send the next word"));
    expect(hintCall).toBeDefined();
    // With only 2 languages, no keyboard is shown - verify no reply_markup in the call
    if (hintCall && hintCall.length > 1) {
      expect(hintCall[1]).not.toHaveProperty("reply_markup");
    }
  });
});
