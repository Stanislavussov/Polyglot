/**
 * Tests for /start command handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext, SessionData } from "../types.js";
import { startCommand } from "./start.js";

// Mock logger (hoisted to avoid TDZ issues)
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock dependencies
vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@polyglot/core", () => ({
  t: vi.fn((key: string) => `[${key}]`),
  isSupported: vi.fn(() => true),
  logger: mockLogger,
}));

vi.mock("@polyglot/infra", () => ({
  logger: mockLogger,
}));

vi.mock("./commands.js", () => ({
  setUserCommands: vi.fn().mockResolvedValue(undefined),
}));

import { userRepository } from "@polyglot/adapter-db";
import { setUserCommands } from "./commands.js";

const repo = vi.mocked(userRepository);

function createMockCtx(overrides: { onboarded?: boolean; userId?: number } = {}): BotContext {
  const session: SessionData = {
    activeMode: "idle",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
  };

  return {
    from: { id: overrides.userId ?? 123456789 },
    chat: { id: 123456789 },
    api: {},
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    user: {
      id: 1,
      telegramId: overrides.userId ?? 123456789,
      audienceGroup: "tester",
      onboarded: overrides.onboarded ?? false,
    },
    conversation: {
      enter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("startCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets activeMode to 'translate' for onboarded users", async () => {
    const ctx = createMockCtx({ onboarded: true });

    await startCommand(ctx);

    expect(ctx.session.activeMode).toBe("translate");
    expect(setUserCommands).toHaveBeenCalledWith(ctx.api, 123456789, "en", "tester");
    expect(ctx.reply).toHaveBeenCalledWith("[welcomeBack]");
  });

  it("persists activeMode to DB for onboarded users", async () => {
    const ctx = createMockCtx({ onboarded: true });

    await startCommand(ctx);

    expect(repo.updateActiveMode).toHaveBeenCalledWith(1, "translate");
  });

  it("enters onboarding for non-onboarded users (no mode change)", async () => {
    const ctx = createMockCtx({ onboarded: false });

    await startCommand(ctx);

    expect(ctx.session.activeMode).toBe("idle"); // unchanged
    expect(ctx.conversation.enter).toHaveBeenCalledWith("onboarding");
    expect(repo.updateActiveMode).not.toHaveBeenCalled();
  });

  it("does nothing when user is not in context", async () => {
    const ctx = createMockCtx();
    (ctx as any).user = undefined;

    await startCommand(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(repo.updateActiveMode).not.toHaveBeenCalled();
  });
});
