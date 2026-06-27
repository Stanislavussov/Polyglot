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
  mockRequestTimingRepository,
  mockLanguageCache,
  mockAi,
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
  mockRequestTimingRepository: {
    record: vi.fn().mockResolvedValue(undefined),
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
  requestTimingRepository: mockRequestTimingRepository,
  languageDetectionRepository: {
    record: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
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
        riskLevel: "low" as const,
        modelId: "test-model",
        attemptCount: 1,
        issues: [],
      },
    }),
    translateOneWithContext: vi.fn().mockResolvedValue({
      status: "accepted",
      output: {
        original: "bank",
        sourceLang: "en",
        emoji: "🏦",
        nativeSynonyms: [],
        translations: {
          cs: { text: "banka", synonyms: [], examples: [] },
        },
      },
      quality: {
        promptVersion: "translation-v1",
        schemaVersion: 1,
        riskLevel: "low" as const,
        modelId: "test-model",
        attemptCount: 1,
        issues: [],
      },
    }),
    detectLanguageWithConfidence: vi.fn((text: string, candidates: string[]) => {
      // Simulate real detection: Cyrillic → Russian, otherwise first candidate
      const hasRu = candidates.includes("ru");
      const language = /[а-яА-ЯЁё]/.test(text) && hasRu ? "ru" : candidates[0];
      return language
        ? {
            language,
            confidence: 0.9,
            evidence: [{ strategy: "mock", candidate: language, score: 0.9, reason: "test fixture" }],
          }
        : { confidence: 0, evidence: [] };
    }),
    detectLanguageWithConfidenceAsync: vi.fn(async () => ({ confidence: 0, evidence: [] })),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { translateOneWithContext, translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../types.js";
import {
  handleRegenCallback,
  handleTranslateText,
  handleTranslationClarificationCallback,
  handleTranslationClarificationContextText,
} from "./translate-mode.helper.js";

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

  it("passes learner-friendly default outputConfig", async () => {
    const ctx = createMockCtx();
    await handleTranslateText(ctx, "hello");

    const inputArg = vi.mocked(translateWithContext).mock.calls[0]![0];
    expect(inputArg.outputConfig).toEqual({
      includeExamples: false,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: false,
      includeUsageNote: true,
      includeConnotationWarning: false,
      includeNativeSynonyms: true,
      includeGrammarBreakdown: false,
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

  it("records the routed translation model in request timing", async () => {
    vi.mocked(translateWithContext).mockResolvedValueOnce({
      status: "accepted",
      output: {
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
      },
      quality: {
        promptVersion: "translation-v1",
        schemaVersion: 1,
        riskLevel: "high",
        modelId: "anthropic/claude-sonnet-4-20250514",
        attemptCount: 1,
        issues: [],
      },
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    expect(mockRequestTimingRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "anthropic/claude-sonnet-4-20250514",
      }),
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

  it("handleRegenCallback is a stub that just answers the callback query", async () => {
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

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(translateOneWithContext).not.toHaveBeenCalled();
  });

  it("handleRegenCallback does not call AI even when credits are available", async () => {
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

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(translateOneWithContext).not.toHaveBeenCalled();
  });

  it("shows clarification UI instead of generic translation error", async () => {
    vi.mocked(translateWithContext).mockResolvedValueOnce({
      status: "needs_clarification",
      ambiguity: {
        reason: "date_or_time",
        message: "The date is ambiguous without locale context.",
        options: [
          { label: "06/07 (month/day)", value: "month-day" },
          { label: "07/06 (day/month)", value: "day-month" },
        ],
      },
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "Meet on 06/07");

    expect(ctx.reply).not.toHaveBeenCalledWith("❌ Translation failed. Please try again later.");
    expect(ctx.session.pendingClarification).toMatchObject({
      word: "Meet on 06/07",
      reason: "date_or_time",
      options: expect.any(Array),
    });
    const promptCall = vi.mocked(ctx.reply).mock.calls.find((call) => call[1]?.reply_markup !== undefined);
    expect(promptCall?.[0]).not.toBe("❌ Translation failed. Please try again later.");
    const keyboard = promptCall?.[1]?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    const callbackData = keyboard.inline_keyboard.flat().map((button) => button.callback_data);
    expect(callbackData).toEqual(
      expect.arrayContaining(["tr:clarify:option:0", "tr:clarify:option:1", "tr:clarify:context"]),
    );
    expect(callbackData).not.toContain("tr:clarify:lang:ru");
    expect(callbackData).not.toContain("tr:clarify:lang:cs");
    expect(callbackData).not.toContain("tr:clarify:lang:de");
    expect(callbackData).not.toContain("tr:clarify:cancel");
  });

  it("does not add source-language buttons to meaning clarification", async () => {
    vi.mocked(translateWithContext).mockResolvedValueOnce({
      status: "needs_clarification",
      ambiguity: {
        reason: "word_sense",
        message: "The word has multiple meanings.",
        options: [
          { label: "patient: noun", value: "person receiving medical care", kind: "meaning" },
          { label: "patient: adjective", value: "able to wait calmly", kind: "meaning" },
        ],
      },
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "patient");

    const promptCall = vi.mocked(ctx.reply).mock.calls.find((call) => call[1]?.reply_markup !== undefined);
    const keyboard = promptCall?.[1]?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    const callbackData = keyboard.inline_keyboard.flat().map((button) => button.callback_data);

    expect(callbackData).toEqual(["tr:clarify:option:0", "tr:clarify:option:1", "tr:clarify:context"]);
  });

  it("uses only core source-language options when source-language ambiguity is returned", async () => {
    vi.mocked(translateWithContext).mockResolvedValueOnce({
      status: "needs_clarification",
      ambiguity: {
        reason: "source_language",
        message: "This spelling can be English or German with different meanings.",
        options: [
          {
            label: "English: quick",
            value: "en",
            kind: "source_language",
            langCode: "en",
          },
          {
            label: "German: almost",
            value: "de",
            kind: "source_language",
            langCode: "de",
          },
        ],
      },
    });
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "fast");

    const promptCall = vi.mocked(ctx.reply).mock.calls.find((call) => call[1]?.reply_markup !== undefined);
    const keyboard = promptCall?.[1]?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    const callbackData = keyboard.inline_keyboard.flat().map((button) => button.callback_data);

    expect(callbackData).toEqual(["tr:clarify:option:0", "tr:clarify:option:1", "tr:clarify:context"]);
  });

  it("sets awaiting state when clarification context is requested", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "bank",
          sourceLang: "en",
          targetLangs: ["cs"],
          inputType: "word",
          reason: "word_sense",
        },
      },
      "tr:clarify:context",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(ctx.session.awaitingTranslationClarificationContext).toBe(true);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it("uses the next text message as clarification context", async () => {
    const ctx = createMockCtx({
      pendingClarification: {
        word: "bank",
        sourceLang: "en",
        targetLangs: ["cs"],
        inputType: "word",
        reason: "word_sense",
      },
      awaitingTranslationClarificationContext: true,
    });

    await handleTranslationClarificationContextText(ctx, "river side");

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "bank",
        sourceLang: "en",
        targetLangs: ["cs"],
        topic: "river side",
      }),
      expect.anything(),
    );
    expect(ctx.session.pendingClarification).toBeUndefined();
    expect(ctx.session.awaitingTranslationClarificationContext).toBeUndefined();
  });

  it("retries with the selected source language and user-language targets", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "fast",
          sourceLang: "ru",
          targetLangs: ["cs", "de"],
          inputType: "word",
          reason: "source_language",
        },
      },
      "tr:clarify:lang:de",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "fast",
        sourceLang: "de",
        targetLangs: ["ru", "cs"],
      }),
      expect.anything(),
    );
  });

  it("retries with a source-language option from core preflight", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "fast",
          sourceLang: "ru",
          targetLangs: ["cs", "de"],
          inputType: "word",
          reason: "source_language",
          options: [
            {
              id: "de",
              label: "German: almost",
              value: "de",
              kind: "source_language",
              langCode: "de",
            },
          ],
        },
      },
      "tr:clarify:option:0",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "fast",
        sourceLang: "de",
        targetLangs: ["ru", "cs"],
      }),
      expect.anything(),
    );
  });

  it("retries with corrected text when a typo option is selected", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "fasr",
          sourceLang: "en",
          targetLangs: ["cs"],
          inputType: "word",
          reason: "possible_typo",
          options: [
            {
              id: "fast",
              label: "fast",
              value: "fast",
              kind: "typo_correction",
              correctedText: "fast",
            },
            {
              id: "as-written",
              label: "Translate as written",
              value: "fasr",
              kind: "translate_as_written",
            },
          ],
        },
      },
      "tr:clarify:option:0",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "fast",
        sourceLang: "en",
        targetLangs: ["cs"],
      }),
      expect.anything(),
    );
  });

  it("uses the corrected text language when a typo option includes langCode", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "paйishent",
          sourceLang: "ru",
          targetLangs: ["cs", "en", "de"],
          inputType: "word",
          reason: "possible_typo",
          options: [
            {
              id: "patient",
              label: "patient",
              value: "patient",
              kind: "typo_correction",
              correctedText: "patient",
              langCode: "en",
            },
          ],
        },
      },
      "tr:clarify:option:0",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "patient",
        sourceLang: "en",
        targetLangs: ["ru", "cs", "de"],
      }),
      expect.anything(),
    );
  });

  it("uses ambiguity option as context hint when no structured pipeline field exists", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "Meet on 06/07",
          sourceLang: "en",
          targetLangs: ["cs"],
          inputType: "phrase",
          reason: "date_or_time",
          options: [
            { label: "06/07 (month/day)", value: "month-day" },
            { label: "07/06 (day/month)", value: "day-month" },
          ],
        },
      },
      "tr:clarify:option:1",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "Meet on 06/07",
        topic: "07/06 (day/month): day-month",
      }),
      expect.anything(),
    );
  });

  it("clears pending clarification on a stale cancel callback", async () => {
    const ctx = createMockCtx(
      {
        pendingClarification: {
          word: "bank",
          sourceLang: "en",
          targetLangs: ["cs"],
          inputType: "word",
          reason: "word_sense",
        },
        awaitingTranslationClarificationContext: true,
      },
      "tr:clarify:cancel",
    );

    await handleTranslationClarificationCallback(ctx);

    expect(ctx.session.pendingClarification).toBeUndefined();
    expect(ctx.session.awaitingTranslationClarificationContext).toBeUndefined();
    expect(translateWithContext).not.toHaveBeenCalled();
  });
});
