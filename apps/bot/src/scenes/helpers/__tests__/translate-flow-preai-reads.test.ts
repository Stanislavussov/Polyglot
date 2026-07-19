/**
 * Pre-AI read behaviour of the translate path (latency Phase 2).
 *
 * Spec:
 *  A. Request-scoped settings memo
 *     - One Telegram update resolves the user's settings AT MOST ONCE, however
 *       many readers ask for them (auth middleware, mode router, translate flow).
 *     - Every reader in that update observes the SAME settings value.
 *     - The memo is scoped to one update and one user: a second update — and any
 *       lookup for a different user id — re-resolves. Settings must never leak
 *       from one user's update into another's.
 *     - `ctx.user.settings` is always `undefined` in this bot and is never read;
 *       the memo wraps `userRepository.getSettings(userId)`.
 *  B. Concurrent independent pre-AI reads
 *     - The default-model resolution and the user's saved template have no data
 *       dependency and are issued concurrently.
 *     - The resolved model / template / output config are unchanged.
 *     - A rejection from either still lands in the existing catch: the user gets
 *       the standard translation error and the request is logged as failed with
 *       the model id that had already resolved.
 *  C. `resolveIsAlreadySaved` stays SEQUENTIAL — its two SELECTs are data
 *     dependent (`existing.id` feeds the second), so the second must not run
 *     when the first finds nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const {
  mockLookupContext,
  mockUserRepository,
  mockIdentityRepository,
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
  mockLookupContext: vi.fn().mockResolvedValue([]),
  mockUserRepository: {
    getSettings: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updateLastInteraction: vi.fn().mockResolvedValue(undefined),
    updateActiveMode: vi.fn().mockResolvedValue(undefined),
  },
  mockIdentityRepository: {
    resolveUserId: vi.fn(),
    linkIdentity: vi.fn().mockResolvedValue(undefined),
  },
  mockVocabularyRepository: {
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
  },
  mockVocabularyDictionaryRepository: {
    entryBelongsToDefault: vi.fn().mockResolvedValue(false),
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
  mockAi: {
    generateObject: vi.fn(),
    generateText: vi.fn().mockResolvedValue("en"),
  },
  mockLogger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockTranslateWithContext = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    status: "accepted",
    output: {
      original: "hello",
      sourceLang: "en",
      emoji: "👋",
      nativeSynonyms: [],
      translations: {
        ru: { text: "привет", synonyms: [], examples: [] },
        cs: { text: "ahoj", synonyms: [], examples: [] },
      },
    },
    quality: {
      promptVersion: "translation-v1",
      schemaVersion: 1,
      riskLevel: "low",
      modelId: "admin-model",
      attemptCount: 1,
      issues: [],
    },
  }),
);

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  actual.initLanguageRegistry([
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", isSupported: true },
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

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: mockLogger,
}));

vi.mock("@polyglot/adapter-youtube", () => ({
  isYouTubeUrl: () => false,
  isVideoUrl: () => false,
}));

import type { InputContext, TranslationOutputConfig } from "@polyglot/core";
import { authMiddleware } from "../../../middlewares/auth.js";
import { modeRouterMiddleware } from "../../../middlewares/mode-router.js";
import { getRequestSettings } from "../../../middlewares/request-settings.js";
import type { BotContext, SessionData } from "../../../types.js";

/** Settings every reader in the update must observe. */
const SETTINGS_A = {
  activeMode: "translate",
  interfaceLang: "en",
  nativeLang: "ru",
  learningLangs: ["cs", "en"],
};

/**
 * Poison value returned from the SECOND getSettings call onwards. Distinct in
 * every field a downstream reader uses, so a cache miss is loudly observable:
 * an empty `learningLangs` short-circuits the translate flow before the AI call.
 */
const SETTINGS_B = {
  activeMode: "mentor",
  interfaceLang: "ru",
  nativeLang: "de",
  learningLangs: [],
};

function createMockCtx(opts: { userId?: number; telegramId?: number; text?: string | undefined } = {}): BotContext {
  const userId = opts.userId ?? 1;
  // authMiddleware re-resolves `ctx.user` from the telegram id, so the two must
  // agree for the mocked repositories to hand back the intended user.
  const telegramId = opts.telegramId ?? userId;
  const session: SessionData = { activeMode: "idle" };

  return {
    from: { id: telegramId },
    chat: { id: telegramId },
    message: "text" in opts && opts.text === undefined ? { sticker: {} } : { text: opts.text ?? "hello" },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
      sendChatAction: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: userId, telegramId, onboarded: true, subscriptionPlan: "free" },
    services: {
      userRepository: mockUserRepository,
      identityRepository: mockIdentityRepository,
      vocabularyRepository: mockVocabularyRepository,
      vocabularyDictionaryRepository: mockVocabularyDictionaryRepository,
      translationTemplateRepository: mockTranslationTemplateRepository,
      translationRequestRepository: mockTranslationRequestRepository,
      languageDetectionRepository: { record: vi.fn().mockResolvedValue(undefined) },
      requestTimingRepository: mockRequestTimingRepository,
      contextLookup: mockLookupContext,
      wordLanguageSweep: vi.fn().mockResolvedValue([]),
      settings: mockSettingsPort,
      languageCache: mockLanguageCache,
      ai: mockAi,
    },
  } as unknown as BotContext;
}

/** Drives one full Telegram update through the real middleware chain. */
async function runUpdate(ctx: BotContext): Promise<void> {
  await authMiddleware(ctx, async () => {
    await modeRouterMiddleware(ctx, async () => {});
  });
}

/** The subset of `translateWithContext` params this spec asserts on. */
interface TranslateCallParams {
  model?: string;
  nativeLang: string;
  inputType: InputContext;
  outputConfig: TranslationOutputConfig;
}

/** The `translateWithContext` params of the Nth call. */
function translateCallParams(index = 0): TranslateCallParams {
  const call = mockTranslateWithContext.mock.calls[index];
  expect(call, "translateWithContext was not called").toBeDefined();
  return call?.[0] as TranslateCallParams;
}

describe("translate pre-AI reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdentityRepository.resolveUserId.mockImplementation((_p: string, ext: string) => Promise.resolve(Number(ext)));
    mockUserRepository.findById.mockImplementation((id: number) =>
      Promise.resolve({ id, telegramId: id, onboarded: true, subscriptionPlan: "free" }),
    );
    mockUserRepository.getSettings.mockResolvedValue(SETTINGS_A);
    mockTranslationTemplateRepository.getByUserId.mockResolvedValue(null);
    mockVocabularyRepository.findByOriginalAndSource.mockResolvedValue(null);
    mockSettingsPort.getDefaultAIModelForPlan.mockResolvedValue("admin-model");
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(0);
  });

  describe("request-scoped settings memo", () => {
    it("resolves settings exactly once for a translate update", async () => {
      const ctx = createMockCtx({ text: "hello" });

      await runUpdate(ctx);

      expect(mockUserRepository.getSettings).toHaveBeenCalledTimes(1);
      expect(mockUserRepository.getSettings).toHaveBeenCalledWith(1);
    });

    it("gives every reader in the update the same settings value", async () => {
      // Only the FIRST resolution returns the real settings; a second SELECT
      // would hand the translate flow a different (empty) learning set.
      mockUserRepository.getSettings.mockReset();
      mockUserRepository.getSettings.mockResolvedValueOnce(SETTINGS_A).mockResolvedValue(SETTINGS_B);
      const ctx = createMockCtx({ text: "hello" });

      await runUpdate(ctx);

      // Auth middleware reader: hydrated the mode from SETTINGS_A.
      expect(ctx.session.activeMode).toBe("translate");
      // Translate flow reader: saw the SAME settings, not the poison value.
      expect(translateCallParams().nativeLang).toBe("ru");
    });

    it("resolves settings once on the non-text branch handled by the mode router", async () => {
      const ctx = createMockCtx({ text: undefined });

      await runUpdate(ctx);

      expect(mockTranslateWithContext).not.toHaveBeenCalled();
      expect(mockUserRepository.getSettings).toHaveBeenCalledTimes(1);
    });

    it("does not leak settings across updates or across users", async () => {
      mockUserRepository.getSettings.mockImplementation((id: number) =>
        Promise.resolve(id === 1 ? SETTINGS_A : { ...SETTINGS_A, nativeLang: "de" }),
      );

      await runUpdate(createMockCtx({ userId: 1, telegramId: 1, text: "hello" }));
      await runUpdate(createMockCtx({ userId: 2, telegramId: 2, text: "hello" }));

      // One resolution per update — and each update resolved its OWN user.
      expect(mockUserRepository.getSettings).toHaveBeenCalledTimes(2);
      expect(mockUserRepository.getSettings).toHaveBeenNthCalledWith(1, 1);
      expect(mockUserRepository.getSettings).toHaveBeenNthCalledWith(2, 2);
      expect(translateCallParams(0).nativeLang).toBe("ru");
      expect(translateCallParams(1).nativeLang).toBe("de");
    });

    it("re-resolves when asked for a different user on the same context", async () => {
      mockUserRepository.getSettings.mockImplementation((id: number) =>
        Promise.resolve({ ...SETTINGS_A, nativeLang: id === 1 ? "ru" : "de" }),
      );
      const ctx = createMockCtx();

      const first = await getRequestSettings(ctx, 1);
      const cached = await getRequestSettings(ctx, 1);
      const other = await getRequestSettings(ctx, 2);

      expect(mockUserRepository.getSettings).toHaveBeenCalledTimes(2);
      expect(cached).toBe(first);
      expect(other?.nativeLang).toBe("de");
    });
  });

  describe("concurrent independent pre-AI reads", () => {
    it("issues the model and template reads concurrently", async () => {
      // The model resolution only completes once the template read has STARTED.
      // Sequential code would deadlock here (and time the test out).
      let releaseModel: ((model: string) => void) | undefined;
      mockSettingsPort.getDefaultAIModelForPlan.mockReturnValue(
        new Promise<string>((resolve) => {
          releaseModel = resolve;
        }),
      );
      mockTranslationTemplateRepository.getByUserId.mockImplementation(async () => {
        releaseModel?.("admin-model");
        return null;
      });

      await runUpdate(createMockCtx({ text: "hello" }));

      expect(mockSettingsPort.getDefaultAIModelForPlan).toHaveBeenCalled();
      expect(mockTranslationTemplateRepository.getByUserId).toHaveBeenCalledWith(1);
      expect(translateCallParams().model).toBe("admin-model");
    });

    it("resolves the same model, template and output config as before", async () => {
      const template = {
        name: "custom",
        fields: {
          synonyms: true,
          examples: false,
          alternatives: false,
          equivalentNote: true,
          connotationWarning: false,
          grammarBreakdown: true,
        },
      };
      mockTranslationTemplateRepository.getByUserId.mockResolvedValue(template);
      const { resolveOutputConfig } = await import("@polyglot/core");

      await runUpdate(createMockCtx({ text: "hello" }));

      const params = translateCallParams();
      expect(params.model).toBe("admin-model");
      expect(params.outputConfig).toEqual(
        resolveOutputConfig({ name: template.name, fields: template.fields }, params.inputType, "hello".length),
      );
    });

    it("records a non-negative db lookup duration for the parallelized section", async () => {
      await runUpdate(createMockCtx({ text: "hello" }));

      const timing = mockRequestTimingRepository.record.mock.calls[0]?.[0] as { dbLookupMs: number };
      expect(timing.dbLookupMs).toBeGreaterThanOrEqual(0);
    });

    it("routes a rejection from either concurrent read to the existing error path", async () => {
      mockTranslationTemplateRepository.getByUserId.mockRejectedValue(new Error("template read failed"));
      const ctx = createMockCtx({ text: "hello" });

      await runUpdate(ctx);

      // Same user-facing outcome as before: no AI call, standard error reply.
      expect(mockTranslateWithContext).not.toHaveBeenCalled();
      const replies = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
      expect(replies.at(-1)).toMatch(/./);
      const failure = mockRequestTimingRepository.record.mock.calls[0]?.[0] as {
        success: boolean;
        error: string;
        modelId?: string;
      };
      expect(failure.success).toBe(false);
      expect(failure.error).toBe("template read failed");
      // The model had already resolved — the error log must still carry it.
      expect(failure.modelId).toBe("admin-model");
    });
  });

  describe("resolveIsAlreadySaved stays sequential", () => {
    it("skips the second, data-dependent SELECT when no entry exists", async () => {
      mockVocabularyRepository.findByOriginalAndSource.mockResolvedValue(null);

      await runUpdate(createMockCtx({ text: "hello" }));

      expect(mockVocabularyRepository.findByOriginalAndSource).toHaveBeenCalled();
      expect(mockVocabularyDictionaryRepository.entryBelongsToDefault).not.toHaveBeenCalled();
    });

    it("feeds the found entry id into the second SELECT", async () => {
      mockVocabularyRepository.findByOriginalAndSource.mockResolvedValue({ id: 7 });

      await runUpdate(createMockCtx({ text: "hello" }));

      expect(mockVocabularyDictionaryRepository.entryBelongsToDefault).toHaveBeenCalledWith(1, 7);
    });
  });
});
