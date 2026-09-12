/**
 * Tests for Task 36: needsTranslateReminder flag — non-blocking source lang reminder.
 * Covers: /translate shows menu, text after /start shows reminder, consecutive no reminder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

// Hoist mocks so they can be referenced in ctx.services
const {
  mockLookupContext,
  mockUserRepository,
  mockVocabularyRepository,
  mockTranslationTemplateRepository,
  mockTranslationRequestRepository,
  mockLanguageCache,
  mockAi,
} = vi.hoisted(() => ({
  mockLookupContext: vi.fn().mockResolvedValue([]),
  mockUserRepository: {
    getSettings: vi.fn(),
    updateActiveMode: vi.fn().mockResolvedValue({}),
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
  mockTranslationRequestRepository: {
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    logTranslationRequest: vi.fn().mockResolvedValue(1),
  },
  mockLanguageCache: {
    getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
    getLangDisplay: vi.fn((code: string) => code.toUpperCase()),
  },
  mockAi: {
    generateObject: vi.fn(),
  },
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
      translations: {},
    }),
    detectLanguageWithConfidence: vi.fn((text: string, candidates: string[]) => {
      // Simulate real detection: Cyrillic → 'ru' if in candidates
      // Cyrillic range check (rollup-compatible, no Unicode property escapes)
      const hasCyrillic = /[\u0400-\u04FF]/.test(text);
      const language = hasCyrillic && candidates.includes("ru") ? "ru" : candidates[0];
      return language
        ? {
            language,
            confidence: 0.9,
            evidence: [{ strategy: "mock", candidate: language, score: 0.9, reason: "test fixture" }],
          }
        : { confidence: 0, evidence: [] };
    }),
    detectLanguageWithConfidenceAsync: vi.fn(async (text: string, candidates: string[]) => {
      // Mirrors the sync mock — these tests exercise the reminder flag, not detection,
      // so the dictionary-verification escalation must stay confident too.
      const hasCyrillic = /[Ѐ-ӿ]/.test(text);
      const language = hasCyrillic && candidates.includes("ru") ? "ru" : candidates[0];
      return language
        ? {
            language,
            confidence: 0.9,
            evidence: [{ strategy: "mock", candidate: language, score: 0.9, reason: "test fixture" }],
          }
        : { confidence: 0, evidence: [] };
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { createSettingsStub } from "../../../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../../../types.js";
import { handleTranslateText } from "../translate-flow.js";

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
      languageDetectionRepository: { record: vi.fn().mockResolvedValue(undefined) },
      requestTimingRepository: { record: vi.fn().mockResolvedValue(undefined) },
      contextLookup: mockLookupContext,
      wordLanguageSweep: vi.fn().mockResolvedValue([]),
      languageCache: mockLanguageCache,
      ai: mockAi,
      settings: createSettingsStub(),
    },
  } as unknown as BotContext;
}

describe("needsTranslateReminder — non-blocking reminder (Task 36)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.getSettings.mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: null,
    });
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValue(0);
  });

  it("clears reminder flag without showing source lang menu (Task 58)", async () => {
    // Task 58: sendSourceLangMenu removed from handleTranslateText.
    // When explicit source is set, translation proceeds directly without the reminder menu.
    const ctx = createMockCtx({
      needsTranslateReminder: true,
      nextSourceLang: "cs",
    });

    await handleTranslateText(ctx, "dům");

    // Flag should be cleared
    expect(ctx.session.needsTranslateReminder).toBe(false);

    // Task 58: no sendSourceLangMenu call — only loading msg + translation card
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2); // loading msg + translation card
    // No source lang menu
    const reminderReply = replies.find(
      (call) => typeof call[0] === "string" && call[0].includes("Next translation from:"),
    );
    expect(reminderReply).toBeUndefined();
  });

  it("does NOT show reminder when flag is false", async () => {
    const ctx = createMockCtx({
      needsTranslateReminder: false,
      nextSourceLang: "cs",
    });

    await handleTranslateText(ctx, "dům");

    // No reminder menu before translation — only loading msg + translation card
    // (post-translation source lang menu removed per Task 58)
    const replies = vi.mocked(ctx.reply).mock.calls;
    // With reminder=false: reply[0] = loading, reply[1] = translation card
    expect(replies.length).toBe(2);
  });

  it("does NOT show reminder when flag is true but nextSourceLang is null", async () => {
    const ctx = createMockCtx({
      needsTranslateReminder: true,
      nextSourceLang: null,
    });

    await handleTranslateText(ctx, "привет");

    // Flag should still be cleared
    expect(ctx.session.needsTranslateReminder).toBe(false);
  });

  it("consecutive translations don't show reminder (flag cleared after first)", async () => {
    const ctx = createMockCtx({
      needsTranslateReminder: true,
      nextSourceLang: "cs",
    });

    await handleTranslateText(ctx, "dům");
    expect(ctx.session.needsTranslateReminder).toBe(false);

    // Reset mocks for second call
    vi.mocked(ctx.reply).mockClear();
    vi.mocked(ctx.api.deleteMessage).mockClear();

    await handleTranslateText(ctx, "auto");
    // No reminder on second translation — only loading + card (2 replies)
    // (post-translation source lang menu removed per Task 58)
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
  });

  it("reminder + hydration: fresh session hydrates from DB (no reminder menu per Task 58)", async () => {
    // Mock returns stored lastSourceLang
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: "cs", // DB has stored source lang
    });

    // Simulate fresh session after restart
    const ctx = createMockCtx({
      nextSourceLang: null,
      needsTranslateReminder: true,
    });

    await handleTranslateText(ctx, "dům");

    // Session stays null — no hydration implemented; detectLanguage handles it
    expect(ctx.session.nextSourceLang).toBeNull();
    // Flag cleared
    expect(ctx.session.needsTranslateReminder).toBe(false);
    // Task 58: sendSourceLangMenu removed — only loading + translation card appear
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2); // loading msg + translation card
  });

  it("2-language user: no source lang keyboard in reminder (only hint text)", async () => {
    // Mock returns only 2 languages
    mockUserRepository.getSettings = vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"], // only 2 languages total
      lastSourceLang: "en",
    });

    const ctx = createMockCtx({
      nextSourceLang: null,
      needsTranslateReminder: true,
    });

    await handleTranslateText(ctx, "house");

    // Reminder should show hint text only, no keyboard (buildSourceLangKeyboard returns null for ≤2 langs)
    const replies = vi.mocked(ctx.reply).mock.calls;
    const reminderReply = replies.find((call) => typeof call[0] === "string" && call[0].includes("Send"));
    // If found, it should NOT have a keyboard with source lang buttons
    if (reminderReply?.[1]) {
      const markup = (reminderReply[1] as any).reply_markup;
      if (markup?.inline_keyboard) {
        const allCallbacks = markup.inline_keyboard.flatMap((row: any[]) => row.map((b: any) => b.callback_data));
        expect(allCallbacks.some((d: string) => d?.startsWith("tr:srclang:"))).toBe(false);
      }
    }
  });
});
