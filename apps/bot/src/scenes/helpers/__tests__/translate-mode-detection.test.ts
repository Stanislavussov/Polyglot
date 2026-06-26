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
  mockTranslationRequestRepository,
  mockLanguageCache,
  mockAi,
  mockLogger,
} = vi.hoisted(() => ({
  mockLookupContext: vi.fn().mockResolvedValue([]),
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
  requestTimingRepository: {
    record: vi.fn().mockResolvedValue(undefined),
  },
  languageDetectionRepository: {
    record: vi.fn().mockResolvedValue(undefined),
  },
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
      status: "accepted",
      output: {
        original: "hello",
        sourceLang: "en",
        emoji: "👋",
        nativeSynonyms: [],
        translations: {
          ru: {
            text: "привет",
            synonyms: [],
            examples: [],
          },
          cs: {
            text: "ahoj",
            synonyms: [],
            examples: [],
          },
        },
      },
      quality: {
        promptVersion: "translation-v1",
        schemaVersion: 1,
        riskLevel: "low",
        modelId: "test-model",
        attemptCount: 1,
        issues: [],
      },
    }),
    detectLanguageWithConfidence: vi.fn((text: string, candidates: string[]) => {
      const hasRu = candidates.includes("ru");
      if (/[а-яА-ЯЁё]/.test(text) && hasRu) {
        return {
          language: "ru",
          confidence: 0.9,
          evidence: [{ strategy: "script", candidate: "ru", score: 0.9, reason: "mock" }],
        };
      }
      if (candidates.length > 0) {
        return {
          language: candidates[0],
          confidence: 0.9,
          evidence: [{ strategy: "mock", candidate: candidates[0], score: 0.9, reason: "mock" }],
        };
      }
      return { confidence: 0, evidence: [] };
    }),
    detectLanguageWithConfidenceAsync: vi.fn(async () => ({ confidence: 0, evidence: [] })),
    logger: mockLogger,
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: mockLogger,
}));

import { detectLanguageWithConfidence, detectLanguageWithConfidenceAsync, translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../../types.js";
import {
  handleMistypeCancelCallback,
  handleMistypeConfirmCallback,
  handleTranslateText,
} from "../translate-mode.helper.js";

function createMockCtx(): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    lastTranslation: undefined,
    lastInputType: undefined,
    savedWordId: undefined,
    needsTranslateReminder: true,
    pendingDetectedLang: undefined,
    pendingWord: undefined,
    pendingDirection: undefined,
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

describe("handleTranslateText — auto-detect language direction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(0);
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

  it("detects language from clean text without trailing context marker", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello #finance");

    expect(detectLanguageWithConfidence).toHaveBeenCalledWith("hello", expect.any(Array));
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

describe("handleTranslateText — mistype warning (Task 58)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    // Mock detectLanguageWithConfidence to return ambiguous (no language detected)
    vi.mocked(detectLanguageWithConfidence).mockReturnValue({ confidence: 0, evidence: [] });
  });

  it("shows mistype warning when detectLanguage returns undefined", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "xyz123");

    const warningCall = vi
      .mocked(ctx.reply)
      .mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("I can't determine"));
    expect(warningCall).toBeDefined();
    expect(warningCall![1]).toHaveProperty("reply_markup");
  });

  it("stores pending state in session when language cannot be detected", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "xyz123");

    expect(ctx.session.pendingDetectedLang).toBeUndefined();
    expect(ctx.session.pendingWord).toBe("xyz123");
    expect(ctx.session.pendingDirection).toBeDefined();
  });

  it("stores clean pending word and context hint when language cannot be detected", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "xyz123 #finance");

    expect(ctx.session.pendingWord).toBe("xyz123");
    expect(ctx.session.pendingContextHint).toBe("finance");
  });

  it("does not call translateWithContext when language cannot be detected", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "xyz123");

    expect(translateWithContext).not.toHaveBeenCalled();
  });

  it("asks for source language when fast has dictionary evidence in English and German", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en", "de"],
    });
    vi.mocked(detectLanguageWithConfidence).mockReturnValue({
      confidence: 0,
      evidence: [
        { strategy: "script", candidate: "en", score: 0.3, reason: "shared Latin script" },
        { strategy: "script", candidate: "de", score: 0.3, reason: "shared Latin script" },
      ],
      ambiguousCandidates: ["en", "de"],
    });
    vi.mocked(detectLanguageWithConfidenceAsync).mockResolvedValue({
      confidence: 0,
      evidence: [
        { strategy: "wiktionary", candidate: "en", score: 0.3, reason: "word exists in multiple dictionaries" },
        { strategy: "wiktionary", candidate: "de", score: 0.3, reason: "word exists in multiple dictionaries" },
      ],
      ambiguousCandidates: ["en", "de"],
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "fast");

    expect(translateWithContext).not.toHaveBeenCalled();
    expect(ctx.session.pendingWord).toBe("fast");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Which language"), {
      reply_markup: expect.any(Object),
    });
  });

  it("does not ask for source language for weak shared-script ambiguity only", async () => {
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en", "de"],
    });
    vi.mocked(detectLanguageWithConfidence).mockReturnValue({
      confidence: 0,
      evidence: [
        { strategy: "script", candidate: "en", score: 0.3, reason: "shared Latin script" },
        { strategy: "script", candidate: "de", score: 0.3, reason: "shared Latin script" },
      ],
      ambiguousCandidates: ["en", "de"],
    });
    vi.mocked(detectLanguageWithConfidenceAsync).mockResolvedValue({
      confidence: 0,
      evidence: [
        { strategy: "script", candidate: "en", score: 0.3, reason: "shared Latin script" },
        { strategy: "script", candidate: "de", score: 0.3, reason: "shared Latin script" },
      ],
      ambiguousCandidates: ["en", "de"],
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    expect(translateWithContext).toHaveBeenCalled();
    expect(ctx.session.pendingWord).toBeUndefined();
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining("Which language"), expect.anything());
  });
});

describe("handleMistypeConfirmCallback — Task 58", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
    vi.mocked(translateWithContext).mockResolvedValue({
      status: "accepted",
      output: {
        original: "xyz123",
        sourceLang: "ru",
        emoji: "👋",
        nativeSynonyms: [],
        translations: {},
      },
      quality: {
        promptVersion: "translation-v1",
        schemaVersion: 1,
        riskLevel: "low",
        modelId: "test-model",
        attemptCount: 1,
        issues: [],
      },
    });
  });

  it("proceeds with translation when confirm callback is triggered", async () => {
    const ctx = createMockCtx();
    ctx.session.pendingWord = "xyz123";
    ctx.session.pendingContextHint = "finance";
    ctx.session.pendingDirection = { sourceLang: "ru", targetLangs: ["cs", "en"] };
    ctx.session.pendingDetectedLang = undefined;

    await handleMistypeConfirmCallback(ctx);

    expect(translateWithContext).toHaveBeenCalled();
    expect(vi.mocked(translateWithContext).mock.calls[0][0]).toEqual(expect.objectContaining({ topic: "finance" }));
    expect(ctx.session.pendingWord).toBeUndefined();
    expect(ctx.session.pendingContextHint).toBeUndefined();
    expect(ctx.session.pendingDirection).toBeUndefined();
  });

  it("shows session expired alert when no pending state", async () => {
    const ctx = createMockCtx();
    // No pending state set

    await handleMistypeConfirmCallback(ctx);

    expect(translateWithContext).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });
});

describe("handleMistypeCancelCallback — Task 58", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    });
  });

  it("clears pending state when cancel callback is triggered", async () => {
    const ctx = createMockCtx();
    ctx.session.pendingWord = "xyz123";
    ctx.session.pendingDirection = { sourceLang: "ru", targetLangs: ["cs", "en"] };
    ctx.session.pendingDetectedLang = undefined;

    await handleMistypeCancelCallback(ctx);

    expect(ctx.session.pendingWord).toBeUndefined();
    expect(ctx.session.pendingDirection).toBeUndefined();
    expect(ctx.session.pendingDetectedLang).toBeUndefined();
  });

  it("replies with translate mode hint after cancel", async () => {
    const ctx = createMockCtx();

    await handleMistypeCancelCallback(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Send the next word or phrase"));
  });
});
