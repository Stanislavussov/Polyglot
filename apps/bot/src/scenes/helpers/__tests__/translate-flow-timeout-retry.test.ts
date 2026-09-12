/**
 * Timeout retry affordance on the translate path.
 *
 * Spec:
 *  - A translation that dies on a user-facing timeout replies with the
 *    "taking longer than expected" notice AND a one-tap retry button, so the
 *    user never has to retype the word.
 *  - The retry payload carries the original input — including the context hint,
 *    which a callback update cannot recover from message entities — keyed by the
 *    notice's message id.
 *  - A hard (non-timeout) failure keeps the plain error text: re-running it would
 *    only fail the same way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({ generateObject: vi.fn() }));

const {
  mockUserRepository,
  mockVocabularyRepository,
  mockVocabularyDictionaryRepository,
  mockTranslationTemplateRepository,
  mockTranslationRequestRepository,
  mockRequestTimingRepository,
  mockLanguageCache,
  mockSettingsPort,
  mockAi,
  mockLogger,
} = vi.hoisted(() => ({
  mockUserRepository: {
    getSettings: vi.fn().mockResolvedValue({
      activeMode: "translate",
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    }),
  },
  mockVocabularyRepository: { findByOriginalAndSource: vi.fn().mockResolvedValue(null) },
  mockVocabularyDictionaryRepository: { entryBelongsToDefault: vi.fn().mockResolvedValue(false) },
  mockTranslationTemplateRepository: { getByUserId: vi.fn().mockResolvedValue(null) },
  mockTranslationRequestRepository: {
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    logTranslationRequest: vi.fn().mockResolvedValue(1),
  },
  mockRequestTimingRepository: { record: vi.fn().mockResolvedValue(undefined) },
  mockLanguageCache: {
    getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
    getLangDisplay: (code: string) => code,
  },
  mockSettingsPort: {
    getDefaultAIModel: vi.fn().mockResolvedValue("admin-model"),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue("admin-model"),
    getPlanLimit: () =>
      Promise.resolve({
        name: "free",
        label: "Free",
        translationLimit: 50,
        creditCost: 1,
        isActive: true,
        isDefault: true,
      }),
  },
  mockAi: { generateObject: vi.fn(), generateText: vi.fn().mockResolvedValue("en") },
  mockLogger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const mockTranslateWithContext = vi.hoisted(() => vi.fn());

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  actual.initLanguageRegistry([
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
  ]);
  return {
    ...actual,
    translateWithContext: mockTranslateWithContext,
    detectLanguageWithConfidence: vi.fn(() => ({
      language: "en",
      confidence: 0.9,
      evidence: [{ strategy: "script", candidate: "en", score: 0.9, reason: "mock" }],
    })),
    detectLanguageWithConfidenceAsync: vi.fn(async () => ({ confidence: 0, evidence: [] })),
    logger: mockLogger,
  };
});

vi.mock("@polyglot/infra", () => ({ loadConfig: () => ({ AI_MODEL: "test-model" }), logger: mockLogger }));
vi.mock("@polyglot/adapter-youtube", () => ({ isYouTubeUrl: () => false, isVideoUrl: () => false }));

import { AITimeoutError, t } from "@polyglot/core";
import type { BotContext, SessionData } from "../../../types.js";
import { RETRY_CALLBACK, takeRetryAction } from "../../../utils/retry-action.js";
import { handleTranslateText } from "../translate-flow.js";

const NOTICE_MSG_ID = 4242;

function createMockCtx(): BotContext & { session: SessionData } {
  const session: SessionData = { activeMode: "translate" };
  return {
    from: { id: 1 },
    chat: { id: 1 },
    message: { text: "hello" },
    session,
    // Loading message first (id 1), then the failure notice.
    reply: vi.fn().mockResolvedValueOnce({ message_id: 1 }).mockResolvedValue({ message_id: NOTICE_MSG_ID }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramId: 1, onboarded: true, subscriptionPlan: "free" },
    services: {
      userRepository: mockUserRepository,
      vocabularyRepository: mockVocabularyRepository,
      vocabularyDictionaryRepository: mockVocabularyDictionaryRepository,
      translationTemplateRepository: mockTranslationTemplateRepository,
      translationRequestRepository: mockTranslationRequestRepository,
      languageDetectionRepository: { record: vi.fn().mockResolvedValue(undefined) },
      requestTimingRepository: mockRequestTimingRepository,
      contextLookup: vi.fn().mockResolvedValue([]),
      wordLanguageSweep: vi.fn().mockResolvedValue([]),
      settings: mockSettingsPort,
      languageCache: mockLanguageCache,
      ai: mockAi,
    },
  } as unknown as BotContext & { session: SessionData };
}

/** The last `ctx.reply` call, as [text, extra]. */
function lastReply(ctx: BotContext): [string, { reply_markup?: { inline_keyboard: { callback_data?: string }[][] } }?] {
  const calls = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as ReturnType<typeof lastReply>;
}

describe("translate flow — user-facing timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers a retry button on the timeout notice", async () => {
    mockTranslateWithContext.mockRejectedValue(new AITimeoutError(15_000));
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    const [text, extra] = lastReply(ctx);
    expect(text).toBe(t("loadingTimeout", "en"));
    expect(extra?.reply_markup?.inline_keyboard[0][0].callback_data).toBe(RETRY_CALLBACK);
  });

  it("stores the original input behind the button, keyed by the notice message", async () => {
    mockTranslateWithContext.mockRejectedValue(new AITimeoutError(15_000));
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    expect(takeRetryAction(ctx.session, NOTICE_MSG_ID)).toMatchObject({ kind: "translate", text: "hello" });
  });

  it("preserves the context hint in the retry payload", async () => {
    mockTranslateWithContext.mockRejectedValue(new AITimeoutError(15_000));
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello :: greeting someone");

    expect(takeRetryAction(ctx.session, NOTICE_MSG_ID)).toMatchObject({
      kind: "translate",
      text: "hello :: greeting someone",
    });
  });

  it("keeps the plain error — with no retry button — for a hard failure", async () => {
    mockTranslateWithContext.mockRejectedValue(new Error("provider exploded"));
    const ctx = createMockCtx();

    await handleTranslateText(ctx, "hello");

    const [text, extra] = lastReply(ctx);
    expect(text).toBe(t("translationError", "en"));
    expect(extra?.reply_markup).toBeUndefined();
    expect(ctx.session.pendingRetries).toBeUndefined();
  });
});
