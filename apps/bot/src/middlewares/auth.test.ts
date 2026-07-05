/**
 * Tests for auth middleware — user resolution + activeMode hydration from DB.
 */
import type { ServiceContainer } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../types.js";
import { authMiddleware } from "./auth.js";

vi.mock("@polyglot/infra", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

const repo = {
  findById: vi.fn(),
  create: vi.fn(),
  getSettings: vi.fn(),
  updateLastInteraction: vi.fn().mockResolvedValue(undefined),
};

const identityRepo = {
  resolveUserId: vi.fn(),
  findExternalId: vi.fn(),
  linkIdentity: vi.fn().mockResolvedValue(undefined),
};

function createMockCtx(overrides: { telegramId?: number; sessionActiveMode?: string } = {}): BotContext {
  const session: SessionData = {
    activeMode: (overrides.sessionActiveMode as any) ?? "translate",
    pendingTranslation: undefined,
    pendingCardMsgId: undefined,
    nextSourceLang: null,
  };

  return {
    from: overrides.telegramId !== undefined ? { id: overrides.telegramId, username: "testuser" } : undefined,
    session,
    user: undefined as any,
    services: createServicesStub({
      userRepository: repo as unknown as ServiceContainer["userRepository"],
      identityRepository: identityRepo as unknown as ServiceContainer["identityRepository"],
    }),
  } as unknown as BotContext;
}

const FAKE_USER = {
  id: 1,
  username: "testuser",
  subscriptionPlan: "free",
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

/** Configure the identity + user mocks so `resolveUserId → findById` yields `user`. */
function resolveExistingUser(user: unknown): void {
  identityRepo.resolveUserId.mockResolvedValue(FAKE_USER.id);
  repo.findById.mockResolvedValue(user as any);
}

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
    expect(identityRepo.resolveUserId).not.toHaveBeenCalled();
  });

  it("loads existing user via identity resolution and attaches to ctx.user", async () => {
    resolveExistingUser(FAKE_USER);
    repo.getSettings.mockResolvedValue(FAKE_SETTINGS as any);
    const ctx = createMockCtx({ telegramId: 123456 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.user).toBe(FAKE_USER);
    expect(identityRepo.resolveUserId).toHaveBeenCalledWith("telegram", "123456");
    expect(repo.findById).toHaveBeenCalledWith(1);
    expect(next).toHaveBeenCalled();
  });

  it("creates new user and links identity when unresolved", async () => {
    identityRepo.resolveUserId.mockResolvedValue(null);
    const newUser = { ...FAKE_USER, onboarded: false, onboardingStep: 0 };
    repo.create.mockResolvedValue(newUser as any);
    const ctx = createMockCtx({ telegramId: 999 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(repo.create).toHaveBeenCalledWith({
      telegramId: 999,
      username: "testuser",
    });
    expect(identityRepo.linkIdentity).toHaveBeenCalledWith(newUser.id, "telegram", "999");
    expect(ctx.user).toBe(newUser);
    expect(next).toHaveBeenCalled();
  });

  it("hydrates session activeMode from DB for onboarded users", async () => {
    resolveExistingUser(FAKE_USER);
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
    resolveExistingUser(FAKE_USER);
    repo.getSettings.mockResolvedValue({
      ...FAKE_SETTINGS,
      activeMode: "quiz", // future mode not yet in UserMode type
    } as any);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "idle",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("translate");
  });

  it("hydrates mentor mode from DB without falling back", async () => {
    resolveExistingUser(FAKE_USER);
    repo.getSettings.mockResolvedValue({
      ...FAKE_SETTINGS,
      activeMode: "mentor",
    } as any);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "idle",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("mentor");
  });

  it("does not hydrate activeMode for non-onboarded users", async () => {
    const nonOnboardedUser = { ...FAKE_USER, onboarded: false };
    resolveExistingUser(nonOnboardedUser);
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
    resolveExistingUser(FAKE_USER);
    repo.getSettings.mockResolvedValue(null);
    const ctx = createMockCtx({
      telegramId: 123456,
      sessionActiveMode: "translate",
    });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(ctx.session.activeMode).toBe("translate"); // unchanged default
  });

  it("calls updateLastInteraction fire-and-forget for onboarded users", async () => {
    resolveExistingUser(FAKE_USER);
    repo.getSettings.mockResolvedValue(FAKE_SETTINGS as any);
    const ctx = createMockCtx({ telegramId: 123456 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(repo.updateLastInteraction).toHaveBeenCalledWith(FAKE_USER.id);
  });

  it("does not call updateLastInteraction for non-onboarded users", async () => {
    const nonOnboardedUser = { ...FAKE_USER, onboarded: false };
    resolveExistingUser(nonOnboardedUser);
    const ctx = createMockCtx({ telegramId: 123456 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    expect(repo.updateLastInteraction).not.toHaveBeenCalled();
  });

  it("does not block request when updateLastInteraction fails", async () => {
    resolveExistingUser(FAKE_USER);
    repo.getSettings.mockResolvedValue(FAKE_SETTINGS as any);
    repo.updateLastInteraction.mockRejectedValue(new Error("db error"));
    const ctx = createMockCtx({ telegramId: 123456 });
    const next = vi.fn().mockResolvedValue(undefined);

    await authMiddleware(ctx, next);

    // next() should still be called despite the error
    expect(next).toHaveBeenCalled();
  });
});
