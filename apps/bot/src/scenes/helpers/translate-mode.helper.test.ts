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
      register: "neutral",
      translations: {
        cs: {
          text: "ahoj",
          register: "colloquial",
          synonyms: [],
          examples: [],
        },
      },
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

import { translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../types.js";
import { handleTranslateText } from "./translate-mode.helper.js";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
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

describe("handleTranslateText — context enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "de"],
    });
  });

  it("calls translateWithContext with correct input and deps", async () => {
    const ctx = createMockCtx();
    // Mock detectLanguage returns "ru" (candidates[0]) for Latin text
    // "ru" is native lang → standard direction: sourceLang=ru, targets=[cs, de]
    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "hello",
        // detectLanguage returns "ru" (first candidate, Latin text), which is nativeLang
        // nativeLang in candidates → standard direction: source=native, targets=learningLangs
        sourceLang: "ru",
        targetLangs: ["cs", "de"],
      }),
      expect.objectContaining({
        lookupContext: mockLookupContext,
        generateObjectFn: expect.any(Function),
      }),
    );
  });

  it("passes FULL_OUTPUT preset as outputConfig", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const inputArg = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect(inputArg.outputConfig).toEqual({
      includeExamples: true,
      includeTranscription: true,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: true,
      includeRegister: false,
      includeConnotationWarning: true,
      includeNativeSynonyms: true,
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
});
