/**
 * Tests for the persistent translate mode system.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BotContext, SessionData, UserMode } from "../types.js";
import { modeRouterMiddleware } from "../middlewares/mode-router.js";

// Mock dependencies
vi.mock("@polyglot/adapter-ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
    create: vi.fn(),
    getSettings: vi.fn(),
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

import { handleTranslateText } from "../scenes/helpers/translate-mode.helper.js";

function createMockContext(
  overrides: {
    text?: string;
    activeMode?: UserMode;
  } = {},
): BotContext {
  const session: SessionData = {
    activeMode: overrides.activeMode ?? "idle",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
  };

  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    message: overrides.text !== undefined ? { text: overrides.text } : undefined,
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
    user: { id: 1, telegramId: 123456789 },
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

    it("calls next() in idle mode", async () => {
      const ctx = createMockContext({ text: "hello", activeMode: "idle" });
      const next = vi.fn().mockResolvedValue(undefined);

      await modeRouterMiddleware(ctx, next);

      expect(next).toHaveBeenCalled();
      expect(handleTranslateText).not.toHaveBeenCalled();
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
  it("has correct initial state", () => {
    const session: SessionData = {
      activeMode: "idle",
      pendingTranslation: undefined,
      pendingCardMsgId: undefined,
    };

    expect(session.activeMode).toBe("idle");
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
