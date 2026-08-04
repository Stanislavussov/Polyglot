/**
 * Tests for /start command handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAIN_KEYBOARD_VERSION } from "../middlewares/main-keyboard.js";
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
vi.mock("@polyglot/core", () => ({
  t: vi.fn((key: string) => `[${key}]`),
  isSupported: vi.fn(() => true),
  getSupportedLangs: vi.fn(() => ["en"]),
  logger: mockLogger,
}));

vi.mock("@polyglot/infra", () => ({
  logger: mockLogger,
}));

vi.mock("./commands.js", () => ({
  setUserCommands: vi.fn().mockResolvedValue(undefined),
}));

import type { ServiceContainer } from "@polyglot/core";
import { createServicesStub } from "../test-helpers/services-stub.js";
import { setUserCommands } from "./commands.js";

const mockUserRepository = {
  getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
  updateActiveMode: vi.fn().mockResolvedValue({}),
};

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
    services: createServicesStub({
      userRepository: mockUserRepository as unknown as ServiceContainer["userRepository"],
    }),
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
    expect(ctx.reply).toHaveBeenCalledWith(
      "[welcomeBack]",
      expect.objectContaining({ reply_markup: expect.objectContaining({ is_persistent: true }) }),
    );
  });

  it("re-installs the main-menu keyboard for onboarded users", async () => {
    const ctx = createMockCtx({ onboarded: true });

    await startCommand(ctx);

    expect(ctx.session.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
    const [, options] = vi.mocked(ctx.reply).mock.calls[0] ?? [];
    const labels = (options?.reply_markup as { keyboard: { text: string }[][] }).keyboard.flat();
    expect(labels.map((button) => button.text)).toEqual([
      "📖 [menuBtnDictionary]",
      "🎴 [menuBtnFlashcards]",
      "🎬 [menuBtnVideos]",
    ]);
  });

  it("persists activeMode to DB for onboarded users", async () => {
    const ctx = createMockCtx({ onboarded: true });

    await startCommand(ctx);

    expect(mockUserRepository.updateActiveMode).toHaveBeenCalledWith(1, "translate");
  });

  it("enters onboarding for non-onboarded users (no mode change)", async () => {
    const ctx = createMockCtx({ onboarded: false });

    await startCommand(ctx);

    expect(ctx.session.activeMode).toBe("idle"); // unchanged
    expect(ctx.conversation.enter).toHaveBeenCalledWith("onboarding");
    expect(mockUserRepository.updateActiveMode).not.toHaveBeenCalled();
  });

  it("does nothing when user is not in context", async () => {
    const ctx = createMockCtx();
    (ctx as any).user = undefined;

    await startCommand(ctx);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mockUserRepository.updateActiveMode).not.toHaveBeenCalled();
  });
});
