/**
 * Tests for the persistent translate mode system.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { modeRouterMiddleware } from "../middlewares/mode-router.js";
import type { BotContext, SessionData, UserMode } from "../types.js";

// Mock dependencies
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
    create: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  },
  wordRepository: {
    create: vi.fn(),
  },
}));

vi.mock("@polyglot/core", () => ({
  translate: vi.fn(),
  t: vi.fn((key: string) => `[${key}]`),
  isSupported: vi.fn(() => true),
}));

vi.mock("@polyglot/infra", () => ({
  loadConfig: vi.fn(() => ({ AI_MODEL: "test-model" })),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock translate-mode helper
vi.mock("../scenes/helpers/translate-mode.helper.js", () => ({
  handleTranslateText: vi.fn(),
}));

import { userRepository } from "@polyglot/adapter-db";
import { handleTranslateText } from "../scenes/helpers/translate-mode.helper.js";

const repo = vi.mocked(userRepository);

function createMockContext(
  overrides: { text?: string; activeMode?: UserMode; onboarded?: boolean; userId?: number } = {},
): BotContext {
  const session: SessionData = {
    activeMode: overrides.activeMode ?? "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
  };

  return {
    from: { id: overrides.userId ?? 123456789 },
    chat: { id: 123456789 },
    message: overrides.text !== undefined ? { text: overrides.text } : undefined,
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    user: {
      id: 1,
      telegramId: overrides.userId ?? 123456789,
      onboarded: overrides.onboarded ?? true,
    },
  } as unknown as BotContext;
}

describe("Translate Mode System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("modeRouterMiddleware", () => {
    it("calls next() for commands (text starting with /)", async () => {
      const ctx = createMockContext({ text: "/translate", activeMode: "translate" });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(handleTranslateText).not.toHaveBeenCalled();
    });

    it("calls next() when no message text", async () => {
      const ctx = createMockContext({ text: undefined, activeMode: "translate" });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(handleTranslateText).not.toHaveBeenCalled();
    });

    it("routes plain text to handleTranslateText when in translate mode", async () => {
      const ctx = createMockContext({ text: "hello", activeMode: "translate" });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(handleTranslateText).toHaveBeenCalledWith(ctx, "hello");
      expect(next).not.toHaveBeenCalled();
    });

    it("falls back to translation in idle mode for onboarded user", async () => {
      const ctx = createMockContext({
        text: "hello",
        activeMode: "idle",
        onboarded: true,
      });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(handleTranslateText).toHaveBeenCalledWith(ctx, "hello");
      expect(next).not.toHaveBeenCalled();
      // Should also fix the session mode
      expect(ctx.session.activeMode).toBe("translate");
    });

    it("persists idle→translate fallback to DB for onboarded user", async () => {
      const ctx = createMockContext({
        text: "hello",
        activeMode: "idle",
        onboarded: true,
      });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(repo.updateActiveMode).toHaveBeenCalledWith(1, "translate");
    });

    it("shows hint for non-onboarded user in idle mode", async () => {
      const ctx = createMockContext({
        text: "hello",
        activeMode: "idle",
        onboarded: false,
      });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(handleTranslateText).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith("[welcome]");
    });

    it("falls back to translation for unknown mode with onboarded user", async () => {
      const ctx = createMockContext({
        text: "hello",
        activeMode: "something_unknown" as UserMode,
        onboarded: true,
      });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(handleTranslateText).toHaveBeenCalledWith(ctx, "hello");
      expect(ctx.session.activeMode).toBe("translate");
    });
  });
});

describe("UserMode type", () => {
  it("supports idle mode", () => {
    const mode: UserMode = "idle";
    expect(mode).toBe("idle");
  });

  it("supports translate mode", () => {
    const mode: UserMode = "translate";
    expect(mode).toBe("translate");
  });
});

describe("SessionData", () => {
  it("has translate as default active mode", () => {
    const session: SessionData = {
      activeMode: "translate",
      pendingTranslation: undefined,
      pendingCardMsgId: undefined,
      nextSourceLang: null,
    };

    expect(session.activeMode).toBe("translate");
    expect(session.pendingTranslation).toBeUndefined();
    expect(session.pendingCardMsgId).toBeUndefined();
  });

  it("can store pending translation", () => {
    const mockOutput = {
      original: "hello",
      sourceLang: "en",
      translations: { cs: { translation: "ahoj" } },
    };

    const session: SessionData = {
      activeMode: "translate",
      pendingTranslation: mockOutput as any,
      pendingCardMsgId: 123,
    };

    expect(session.pendingTranslation).toBe(mockOutput);
    expect(session.pendingCardMsgId).toBe(123);
  });
});
