/**
 * Tests for handleSourceLangCallback — source language selection via inline keyboard.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock external modules before imports
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn(),
    updateLastSourceLang: vi.fn().mockResolvedValue(undefined),
  },
  vocabularyRepository: {
    create: vi.fn().mockResolvedValue({ id: 1, translations: [] }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
    updateTranslation: vi.fn().mockResolvedValue({}),
  },
  createContextLookup: () => vi.fn(),
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
  return actual;
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { userRepository } from "@polyglot/adapter-db";
import type { BotContext, SessionData } from "../../../types.js";
import { handleSourceLangCallback } from "../translate-mode.helper.js";

function createMockCtx(callbackData: string): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    callbackQuery: { data: callbackData },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    user: { id: 1, telegramId: 123456789 },
  } as unknown as BotContext;
}

describe("handleSourceLangCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userRepository.getSettings).mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    } as any);
  });

  it("sets session.nextSourceLang to the selected language code", async () => {
    const ctx = createMockCtx("tr:srclang:cs");
    await handleSourceLangCallback(ctx);

    expect(ctx.session.nextSourceLang).toBe("cs");
  });

  it("sends confirmation via answerCallbackQuery", async () => {
    const ctx = createMockCtx("tr:srclang:cs");
    await handleSourceLangCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: expect.stringContaining("Czech"),
    });
  });

  it("updates keyboard in-place with new ✓ mark", async () => {
    const ctx = createMockCtx("tr:srclang:en");
    await handleSourceLangCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        reply_markup: expect.anything(),
      }),
    );
  });

  it("switches nextSourceLang when a different language is tapped", async () => {
    const ctx = createMockCtx("tr:srclang:cs");
    ctx.session.nextSourceLang = "en"; // previously selected English
    await handleSourceLangCallback(ctx);

    expect(ctx.session.nextSourceLang).toBe("cs");
  });

  it("handles missing callback data gracefully", async () => {
    const ctx = createMockCtx("tr:srclang:cs");
    (ctx as any).callbackQuery = { data: undefined };
    await handleSourceLangCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.session.nextSourceLang).toBeNull();
  });

  it("uses i18n nextSourceSet key for confirmation", async () => {
    const ctx = createMockCtx("tr:srclang:ru");
    await handleSourceLangCallback(ctx);

    // nextSourceSet → "🔤 Next from: {lang}"
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: expect.stringContaining("Next from:"),
    });
  });

  it("uses i18n nextTranslationFrom key in edited message", async () => {
    const ctx = createMockCtx("tr:srclang:cs");
    await handleSourceLangCallback(ctx);

    const editedText = vi.mocked(ctx.editMessageText).mock.calls[0]?.[0];
    expect(editedText).toContain("Next translation from:");
  });
});
