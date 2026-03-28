/**
 * Tests for nextSourceLang integration in translate-mode helper.
 * Covers explicit source language override (Task 17) and fallback to auto-detect.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

const { mockLookupContext } = vi.hoisted(() => ({
  mockLookupContext: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn(),
  },
  wordRepository: {
    create: vi.fn(),
  },
  createContextLookup: () => mockLookupContext,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  actual.initLanguageRegistry([
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", iso3Code: "eng", isSupported: true },
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", iso3Code: "rus", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", iso3Code: "ces", isSupported: true },
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
    user: { id: 1, telegramId: 123456789 },
  } as unknown as BotContext;
}

describe("handleTranslateText — nextSourceLang integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    } as any);
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
    // Falls back to auto-detect
    expect(translateWithContext).toHaveBeenCalled();
  });

  it("does not show detected language indicator when using explicit source", async () => {
    const ctx = createMockCtx("cs");
    await handleTranslateText(ctx, "dům");

    // Card should NOT have the detected lang prefix
    const replyCall = vi.mocked(ctx.reply).mock.calls.find((call) => call[1] && (call[1] as any).parse_mode === "HTML");
    expect(replyCall).toBeDefined();
    expect(replyCall![0]).not.toContain("Detected:");
  });

  it("logs nextSourceLang in debug output", async () => {
    const { logger } = await import("@polyglot/infra");
    const ctx = createMockCtx("cs");
    await handleTranslateText(ctx, "dům");

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        nextSourceLang: "cs",
        sourceLang: "cs",
      }),
      "Resolved translation direction",
    );
  });
});

describe("handleSaveCallback — source lang menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    } as any);
  });

  it("shows source language menu after save (3+ langs)", async () => {
    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {},
    } as any;
    ctx.session.pendingCardMsgId = 42;

    await handleSaveCallback(ctx);

    // Should reply with keyboard (3 languages = menu shown)
    const lastReply = vi.mocked(ctx.reply).mock.calls.at(-1);
    expect(lastReply).toBeDefined();
    expect(lastReply![0]).toContain("Next translation from:");
    expect(lastReply![1]).toHaveProperty("reply_markup");
  });

  it("shows plain hint after save when only 2 languages", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    } as any);

    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {},
    } as any;
    ctx.session.pendingCardMsgId = 42;

    await handleSaveCallback(ctx);

    const lastReply = vi.mocked(ctx.reply).mock.calls.at(-1);
    expect(lastReply).toBeDefined();
    // Should NOT contain the keyboard header
    expect(lastReply![0]).not.toContain("Next translation from:");
    // Should not have reply_markup
    expect(lastReply![1]).toBeUndefined();
  });
});

describe("handleSkipCallback — source lang menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    } as any);
  });

  it("shows source language menu after skip (3+ langs)", async () => {
    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {},
    } as any;
    ctx.session.pendingCardMsgId = 42;

    await handleSkipCallback(ctx);

    const lastReply = vi.mocked(ctx.reply).mock.calls.at(-1);
    expect(lastReply).toBeDefined();
    expect(lastReply![0]).toContain("Next translation from:");
    expect(lastReply![1]).toHaveProperty("reply_markup");
  });

  it("shows plain hint after skip when only 2 languages", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["en"],
    } as any);

    const ctx = createMockCtx(null);
    ctx.session.pendingTranslation = {
      original: "test",
      sourceLang: "ru",
      emoji: "🏠",
      register: "neutral",
      translations: {},
    } as any;
    ctx.session.pendingCardMsgId = 42;

    await handleSkipCallback(ctx);

    const lastReply = vi.mocked(ctx.reply).mock.calls.at(-1);
    expect(lastReply).toBeDefined();
    expect(lastReply![0]).not.toContain("Next translation from:");
    expect(lastReply![1]).toBeUndefined();
  });
});
