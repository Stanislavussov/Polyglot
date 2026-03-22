/**
 * Tests for auth middleware — user resolution + activeMode hydration from DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authMiddleware } from "./auth.js";
import type { BotContext, SessionData } from "../types.js";

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
    create: vi.fn(),
    getSettings: vi.fn(),
  },
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

function createMockCtx(overrides: {
  telegramId?: number;
  sessionActiveMode?: string;
} = {}): BotContext {
  const session: SessionData = {
    activeMode: (overrides.sessionActiveMode as any) ?? "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
  };

  return {
    from: overrides.telegramId !== undefined
      ? { id: overrides.telegramId, username: "testuser" }
      : undefined,
    session,
    user: undefined as any,
  } as unknown as BotContext;
}

const FAKE_USER = {
  id: 1,
  telegramId: 123456,
  username: "testuser",
  onboardingStep: 4,
  onboarded: true,
  isActive: true,
  createdAt: new Date(),
};

const FAKE_SETTINGS = {
  id: 1,
  userId: 1,
  interfaceLang: "en",
  nativeLang: "en",
  learningLangs: ["cs"],
  timezone: "UTC",
  activeMode: "translate",
  isActive: true,
  updatedAt: new Date(),
};

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() when no from.id (e.g. channel post)", async () => {
    const ctx = createMockCtx({ telegramId: undefined } as any);
    (ctx as any).from = undefined;
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(repo.findByTelegramId).not.toHaveBeenCalled();
  });

  it("loads existing user and attaches to ctx.user", async () => {
    repo.findByTelegramId.mockResolvedValue(FAKE_USER as any);
    repo.getSettings.mockResolvedValue(FAKE_SETTINGS as any);
    const ctx = createMockCtx({ telegramId: 123456 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.user).toBe(FAKE_USER);
    expect(repo.findByTelegramId).toHaveBeenCalledWith(123456);
    expect(next).toHaveBeenCalled();
  });

  it("creates new user when not found", async () => {
    repo.findByTelegramId.mockResolvedValue(null);
    const newUser = { ...FAKE_USER, onboarded: false, onboardingStep: 0 };
    repo.create.mockResolvedValue(newUser as any);
    const ctx = createMockCtx({ telegramId: 999 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(repo.create).toHaveBeenCalledWith({
      telegramId: 999,
      username: "testuser",
    });
    expect(ctx.user).toBe(newUser);
    expect(next).toHaveBeenCalled();
  });

  it("hydrates session activeMode from DB for onboarded users", async () => {
    repo.findByTelegramId.mockResolvedValue(FAKE_USER as any);
    repo.getSettings.mockResolvedValue({
      ...FAKE_SETTINGS,
      activeMode: "translate",
    } as any);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "idle",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("translate");
    expect(repo.getSettings).toHaveBeenCalledWith(1);
  });

  it("falls back to 'translate' for unknown DB mode values", async () => {
    repo.findByTelegramId.mockResolvedValue(FAKE_USER as any);
    repo.getSettings.mockResolvedValue({
      ...FAKE_SETTINGS,
      activeMode: "mentor", // future mode not yet in UserMode type
    } as any);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "idle",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("translate");
  });

  it("does not hydrate activeMode for non-onboarded users", async () => {
    const nonOnboardedUser = { ...FAKE_USER, onboarded: false };
    repo.findByTelegramId.mockResolvedValue(nonOnboardedUser as any);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "idle",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("idle"); // unchanged
    expect(repo.getSettings).not.toHaveBeenCalled();
  });

  it("keeps session default when onboarded user has no settings row", async () => {
    repo.findByTelegramId.mockResolvedValue(FAKE_USER as any);
    repo.getSettings.mockResolvedValue(null);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "translate",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("translate"); // unchanged default
  });
});
