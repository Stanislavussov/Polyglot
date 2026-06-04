/**
 * Tests for dictionary context integration in translate-mode helper.
 * Covers lookupDictContext and dictionaryContext wiring in handleTranslateText.
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
  mockTranslationRequestRepository,
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
  mockTranslationRequestRepository: {
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    logTranslationRequest: vi.fn().mockResolvedValue(1),
  },
  mockLanguageCache: {
    getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
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
  translationTemplateRepository: mockTranslationTemplateRepository,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    translateWithContext: vi.fn().mockResolvedValue({
      original: "hello",
      sourceLang: "en",
      emoji: "👋",
      nativeSynonyms: [],
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [],
        },
      },
    }),
    translateOneWithContext: vi.fn().mockResolvedValue({
      text: "banka",
      synonyms: [],
      examples: [],
    }),
    detectLanguage: vi.fn((text: string, candidates: string[]) => {
      // Simulate real detection: Cyrillic → Russian, otherwise first candidate
      const hasRu = candidates.includes("ru");
      if (/[а-яА-ЯЁё]/.test(text) && hasRu) return "ru";
      return candidates.length > 0 ? candidates[0] : undefined;
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { translateOneWithContext, translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../types.js";
import { handleRegenCallback, handleTranslateText } from "./translate-mode.helper.js";

function createMockCtx(overrides?: Partial<SessionData>, callbackData?: string): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    needsTranslateReminder: false,
    lastTranslation: undefined,
    lastInputType: undefined,
    savedWordId: undefined,
    templateWizard: undefined,
    dictionary: undefined,
    flashcard: undefined,
    pendingDetectedLang: undefined,
    pendingWord: undefined,
    pendingDirection: undefined,
    ...overrides,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    callbackQuery: callbackData ? { data: callbackData } : undefined,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramId: 123456789 },
    services: {
      userRepository: mockUserRepository,
      vocabularyRepository: mockVocabularyRepository,
      translationTemplateRepository: mockTranslationTemplateRepository,
      translationRequestRepository: mockTranslationRequestRepository,
      languageCache: mockLanguageCache,
      ai: mockAi,
    },
  } as unknown as BotContext;
}

describe("handleTranslateText — context enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "de"],
    });
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(0);
  });

  it("calls translateWithContext with correct input and deps", async () => {
    const ctx = createMockCtx();
    // Mock detectLanguage returns "ru" (candidates[0]) for Latin text
    // "ru" is native lang → sourceLang=ru, targets=[cs, de]
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "hello",
        // detectLanguage returns "ru" (first candidate, Latin text), which is nativeLang
        // nativeLang in candidates → source=native, targets=learningLangs
        sourceLang: "ru",
        targetLangs: ["cs", "de"],
      }),
      expect.objectContaining({
        lookupContext: mockLookupContext,
        generateObjectFn: expect.any(Function),
      }),
    );
  });

  it("logs one credit after successful incoming translation request", async () => {
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    expect(mockTranslationRequestRepository.logTranslationRequest).toHaveBeenCalledWith(
      1,
      "hello",
      "ru",
      ["cs", "de"],
      1,
    );
  });

  it("does not call AI when daily credits are exhausted", async () => {
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(50);
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Daily translation limit"));
  });

  it("passes reliable default outputConfig", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const inputArg = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect(inputArg.outputConfig).toEqual({
      includeExamples: false,
      includeTranscription: true,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeConnotationWarning: false,
      includeNativeSynonyms: false,
    });
  });

  it("passes lookupContext from createContextLookup to deps", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const depsArg = vi.mocked(translateWithContext).mock.calls[0]![1];
    expect(depsArg.lookupContext).toBe(mockLookupContext);
  });

  it("does not include dictionaryContext in input (layer fills it)", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const inputArg = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect("dictionaryContext" in inputArg).toBe(false);
  });

  it("includes userId in translateWithContext input", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
      }),
      expect.anything(),
    );
  });

  it("passes clean text and context hint to translateWithContext", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "bank #finance");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "bank",
        topic: "finance",
      }),
      expect.anything(),
    );
  });

  it("passes free-form context description to translateWithContext", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "bank :: financial institution");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "bank",
        topic: "financial institution",
      }),
      expect.anything(),
    );
  });

  it("does not request a native-language translation block for native source text", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "биться в шары :: не видеть");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "биться в шары",
        sourceLang: "ru",
        targetLangs: ["cs", "en"],
        topic: "не видеть",
      }),
      expect.anything(),
    );
  });

  it("stores context hint in translationMap for regeneration", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "bank #finance");

    expect(ctx.session.translationMap?.["1"]?.contextHint).toBe("finance");
  });

  it("rejects marker-only input before calling AI", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "#finance");

    expect(ctx.reply).toHaveBeenCalledWith("Enter a word or phrase before the context marker.");
    expect(translateWithContext).not.toHaveBeenCalled();
  });

  it("passes stored context hint to translateOneWithContext during regeneration", async () => {
    const msgId = 99;
    const ctx = createMockCtx(
      {
        translationMap: {
          [String(msgId)]: {
            output: {
              original: "bank",
              sourceLang: "en",
              emoji: "🏦",
              nativeSynonyms: [],
              translations: {
                cs: {
                  text: "breh",
                  synonyms: [],
                  examples: [],
                },
              },
            },
            inputType: "word",
            contextHint: "river",
          },
        },
      },
      `tr:regen:cs:${msgId}`,
    );

    await handleRegenCallback(ctx);

    expect(translateOneWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "bank",
        topic: "river",
        targetLang: "cs",
      }),
      expect.anything(),
    );
  });

  it("does not apply user-facing rate limits to regeneration", async () => {
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(49);
    const msgId = 99;
    const ctx = createMockCtx(
      {
        translationMap: {
          [String(msgId)]: {
            output: {
              original: "bank",
              sourceLang: "en",
              emoji: "🏦",
              nativeSynonyms: [],
              translations: {
                cs: {
                  text: "breh",
                  synonyms: [],
                  examples: [],
                },
              },
            },
            inputType: "word",
          },
        },
      },
      `tr:regen:cs:${msgId}`,
    );

    await handleRegenCallback(ctx);

    expect(translateOneWithContext).toHaveBeenCalled();
    expect(mockTranslationRequestRepository.logTranslationRequest).not.toHaveBeenCalledWith(
      1,
      "bank",
      "en",
      ["cs"],
      expect.any(Number),
    );
  });
});
