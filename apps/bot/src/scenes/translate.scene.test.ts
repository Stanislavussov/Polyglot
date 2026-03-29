/**
 * Tests for /translate command handler — mode activation + DB persistence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
    }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  },
  getLangDisplay: vi.fn((code: string) => code.toUpperCase()),
  createContextLookup: () => vi.fn(),
  getLang: vi.fn().mockReturnValue({ id: 1, code: "en", name: "English" }),
  translationTemplateRepository: {
    getByUserId: vi.fn().mockResolvedValue(null),
  },
  wordRepository: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findByOriginalAndSource: vi.fn().mockResolvedValue(null),
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
    t: vi.fn((key: string) => `[${key}]`),
    isSupported: vi.fn(() => true),
  };
});

vi.mock("@polyglot/infra", () => ({
  loadConfig: () => ({ AI_MODEL: "test-model" }),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { userRepository } from "@polyglot/adapter-db";
import type { BotContext, SessionData } from "../types.js";
import { handleTranslateCommand } from "./translate.scene.js";

const repo = vi.mocked(userRepository);

function createMockCtx(): BotContext {
  const session: SessionData = {
    activeMode: "idle",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
    needsTranslateReminder: undefined,
  };

  return {
    from: { id: 123456 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    user: { id: 1, telegramId: 123456, onboarded: true },
  } as unknown as BotContext;
}

describe("handleTranslateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets session activeMode to 'translate'", async () => {
    const ctx = createMockCtx();

    await handleTranslateCommand(ctx);

    expect(ctx.session.activeMode).toBe("translate");
  });

  it("persists activeMode to DB", async () => {
    const ctx = createMockCtx();

    await handleTranslateCommand(ctx);

    expect(repo.updateActiveMode).toHaveBeenCalledWith(1, "translate");
  });

  it("sends confirmation message", async () => {
    const ctx = createMockCtx();

    await handleTranslateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith("[translateModeOn]");
  });

  it("shows source language menu after confirmation (3+ langs)", async () => {
    const ctx = createMockCtx();

    await handleTranslateCommand(ctx);

    // reply called twice: confirmation + source lang menu
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBeGreaterThanOrEqual(2);
    // Last reply is the source lang menu
    const lastReply = replies.at(-1);
    expect(lastReply![0]).toContain("[translateModeHint]");
    expect(lastReply![1]).toHaveProperty("reply_markup");
  });

  it("clears needsTranslateReminder after /translate", async () => {
    const ctx = createMockCtx();
    ctx.session.needsTranslateReminder = true;

    await handleTranslateCommand(ctx);

    expect(ctx.session.needsTranslateReminder).toBe(false);
  });
});
