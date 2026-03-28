/**
 * Tests for /translate command handler — mode activation + DB persistence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext, SessionData } from "../types.js";
import { handleTranslateCommand } from "./translate.scene.js";

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    getSettings: vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["cs"],
    }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  },
  getLangDisplay: vi.fn((code: string) => code.toUpperCase()),
}));

vi.mock("@polyglot/core", () => ({
  t: vi.fn((key: string) => `[${key}]`),
  isSupported: vi.fn(() => true),
}));

vi.mock("@polyglot/infra", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

import { userRepository } from "@polyglot/adapter-db";

const repo = vi.mocked(userRepository);

function createMockCtx(): BotContext {
  const session: SessionData = {
    activeMode: "idle",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
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
});
