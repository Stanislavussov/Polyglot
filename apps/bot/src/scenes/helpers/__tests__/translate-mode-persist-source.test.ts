/**
 * Tests for Task 36: Persist source language & lazy hydration from DB.
 * Covers: DB hydration, invalid lang clearing, fire-and-forget DB sync.
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
    updateLastSourceLang: vi.fn().mockResolvedValue(undefined),
  },
  wordRepository: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
  },
  createContextLookup: () => mockLookupContext,
  getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
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
import { translateWithContext } from "@polyglot/core";
import type { BotContext, SessionData } from "../../../types.js";
import { handleSourceLangCallback, handleTranslateText } from "../translate-mode.helper.js";

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

describe("Persist source lang — lazy hydration (Task 36)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: null,
    } as any);
  });

  it("hydrates nextSourceLang from DB when session is empty", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: "cs",
    } as any);

    const ctx = createMockCtx({ nextSourceLang: null });
    await handleTranslateText(ctx, "dům");

    // Should hydrate into session
    expect(ctx.session.nextSourceLang).toBe("cs");
    // Should translate using the hydrated source
    expect(translateWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLang: "cs",
        targetLangs: ["ru", "en"],
      }),
      expect.anything(),
    );
  });

  it("does NOT hydrate when session already has nextSourceLang", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: "en", // DB has English
    } as any);

    const ctx = createMockCtx({ nextSourceLang: "cs" }); // session has Czech
    await handleTranslateText(ctx, "dům");

    // Should use session value, NOT DB value
    expect(ctx.session.nextSourceLang).toBe("cs");
    expect(translateWithContext).toHaveBeenCalledWith(expect.objectContaining({ sourceLang: "cs" }), expect.anything());
  });

  it("clears invalid lastSourceLang from both session and DB", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: "de", // German not in user's config
    } as any);

    const ctx = createMockCtx({ nextSourceLang: null });
    await handleTranslateText(ctx, "hallo");

    // Should clear session
    expect(ctx.session.nextSourceLang).toBeNull();
    // Should clear DB (fire-and-forget)
    expect(userRepository.updateLastSourceLang).toHaveBeenCalledWith(1, null);
    // Should fall back to auto-detect
    expect(translateWithContext).toHaveBeenCalled();
  });

  it("falls back to auto-detect when DB lastSourceLang is null", async () => {
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      lastSourceLang: null,
    } as any);

    const ctx = createMockCtx({ nextSourceLang: null });
    await handleTranslateText(ctx, "привет");

    // Should NOT call updateLastSourceLang (no hydration happened)
    expect(userRepository.updateLastSourceLang).not.toHaveBeenCalled();
    // Should use auto-detect
    expect(translateWithContext).toHaveBeenCalledWith(expect.objectContaining({ sourceLang: "ru" }), expect.anything());
  });

  it("clears from DB when hydrated value becomes invalid on resolveDirectionFromSource", async () => {
    // This tests Step 5: nextSourceLang is set (from hydration or manual)
    // but resolveDirectionFromSource returns null
    const ctx = createMockCtx({ nextSourceLang: "de" }); // German not in user config
    await handleTranslateText(ctx, "hallo");

    expect(ctx.session.nextSourceLang).toBeNull();
    expect(userRepository.updateLastSourceLang).toHaveBeenCalledWith(1, null);
  });
});

describe("Persist source lang — callback DB sync (Task 36)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    } as any);
  });

  it("persists source lang to DB on callback selection", async () => {
    const ctx = createMockCtx();
    (ctx as any).callbackQuery = { data: "tr:srclang:cs" };

    await handleSourceLangCallback(ctx);

    expect(ctx.session.nextSourceLang).toBe("cs");
    expect(userRepository.updateLastSourceLang).toHaveBeenCalledWith(1, "cs");
  });

  it("DB write failure does not break callback (fire-and-forget)", async () => {
    vi.mocked(userRepository.updateLastSourceLang).mockRejectedValue(new Error("DB error"));

    const ctx = createMockCtx();
    (ctx as any).callbackQuery = { data: "tr:srclang:en" };

    // Should not throw
    await handleSourceLangCallback(ctx);

    // Session still updated
    expect(ctx.session.nextSourceLang).toBe("en");
    // Callback still answered
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});
