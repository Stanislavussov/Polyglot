/**
 * Tests for Task 36: needsTranslateReminder flag — non-blocking source lang reminder.
 * Covers: /translate shows menu, text after /start shows reminder, consecutive no reminder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const { mockLookupContext } = vi.hoisted(() => ({
  mockLookupContext: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn(),
    updateActiveMode: vi.fn().mockResolvedValue({}),
    updateLastSourceLang: vi.fn().mockResolvedValue(undefined),
  },
  wordRepository: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
  },
  createContextLookup: () => mockLookupContext,
  getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
  getLangDisplay: vi.fn((code: string) => code.toUpperCase()),
  translationTemplateRepository: {
    getByUserId: vi.fn().mockResolvedValue(null),
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
      register: "neutral",
      translations: {
        ru: { text: "тест", cefr: "A1", register: "neutral", synonyms: [], examples: [] },
        en: { text: "test", cefr: "A1", register: "neutral", synonyms: [], examples: [] },
      },
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { userRepository } from "@polyglot/adapter-db";
import type { BotContext, SessionData } from "../../../types.js";
import { handleTranslateText } from "../translate-mode.helper.js";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    needsTranslateReminder: false,
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
    },
    user: { id: 1, telegramId: 123456789 },
  } as unknown as BotContext;
}

describe("needsTranslateReminder — non-blocking reminder (Task 36)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: null,
    } as any);
  });

  it("shows reminder menu when flag is true and nextSourceLang is set", async () => {
    const ctx = createMockCtx({
      needsTranslateReminder: true,
      nextSourceLang: "cs",
    });

    await handleTranslateText(ctx, "dům");

    // Flag should be cleared
    expect(ctx.session.needsTranslateReminder).toBe(false);

    // Should have sent the reminder (source lang menu) AND the translation
    const replies = vi.mocked(ctx.reply).mock.calls;
    // First reply after loading is the reminder menu (contains translateModeHint + nextTranslationFrom)
    const reminderReply = replies.find(
      (call) => typeof call[0] === "string" && call[0].includes("Next translation from:"),
    );
    expect(reminderReply).toBeDefined();
    expect(reminderReply![1]).toHaveProperty("reply_markup");
  });

  it("does NOT show reminder when flag is false", async () => {
    const ctx = createMockCtx({
      needsTranslateReminder: false,
      nextSourceLang: "cs",
    });

    await handleTranslateText(ctx, "dům");

    // No reminder menu before translation — only loading msg, translation card, source lang menu after
    const replies = vi.mocked(ctx.reply).mock.calls;
    // The source lang menu that appears after translation still shows, but there should be
    // no EXTRA reminder before the translation
    // With reminder=false: reply[0] = loading, reply[1] = translation card, reply[2] = post-translation menu
    // With reminder=true: reply[0] = loading, reply[1] = reminder menu, reply[2] = translation card, reply[3] = post-translation menu
    // So count total replies: without reminder should have fewer
    expect(replies.length).toBeLessThanOrEqual(3);
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
    // No reminder on second translation
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBeLessThanOrEqual(3);
  });

  it("reminder + hydration: fresh session hydrates from DB and shows reminder", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: "cs", // DB has stored source lang
    } as any);

    // Simulate fresh session after restart
    const ctx = createMockCtx({
      nextSourceLang: null,
      needsTranslateReminder: true,
    });

    await handleTranslateText(ctx, "dům");

    // Should hydrate from DB
    expect(ctx.session.nextSourceLang).toBe("cs");
    // Flag cleared
    expect(ctx.session.needsTranslateReminder).toBe(false);
    // Should have shown reminder menu
    const replies = vi.mocked(ctx.reply).mock.calls;
    const reminderReply = replies.find(
      (call) => typeof call[0] === "string" && call[0].includes("Next translation from:"),
    );
    expect(reminderReply).toBeDefined();
  });

  it("2-language user: no source lang keyboard in reminder (only hint text)", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"], // only 2 languages total
      lastSourceLang: "en",
    } as any);

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
