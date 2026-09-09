import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository } = vi.hoisted(() => ({
  mockUserRepository: {
    updateActiveMode: vi.fn().mockResolvedValue({ activeMode: "mentor" }),
    getSettings: vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["cs"],
    }),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
});

import type { ServiceContainer } from "@polyglot/core";
import { createServicesStub } from "../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../types.js";
import { handleMentorCommand } from "./mentor.scene.js";

function createMockCtx(overrides?: Partial<SessionData>, services?: Partial<ServiceContainer>): BotContext {
  const session: SessionData = {
    activeMode: "translate",
    mentor: undefined,
    ...overrides,
  } as SessionData;
  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    user: { id: 1, telegramId: 123456789, onboarded: true, audienceGroup: "product", subscriptionPlan: "plus" },
    services: createServicesStub({
      userRepository: mockUserRepository as unknown as ServiceContainer["userRepository"],
      ...services,
    }),
  } as unknown as BotContext;
}

/** Feature access that refuses everything — the free-plan shape of the gate. */
const denyAll = {
  listFeatures: vi.fn().mockResolvedValue(new Set()),
  listPlanFeatures: vi.fn().mockResolvedValue(new Set()),
  checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: false, reason: "plan" }),
} as unknown as ServiceContainer["featureAccess"];

describe("handleMentorCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets session activeMode to 'mentor'", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(ctx.session.activeMode).toBe("mentor");
  });

  it("persists mode to DB via updateActiveMode", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(mockUserRepository.updateActiveMode).toHaveBeenCalledWith(1, "mentor");
  });

  it("marks a fresh thread on entry (empty object, no thread pinned)", async () => {
    const ctx = createMockCtx({ mentor: { threadId: "11111111-1111-4111-8111-111111111111" } });
    await handleMentorCommand(ctx);
    expect(ctx.session.mentor).toEqual({});
  });

  it("replies with a confirmation message", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = vi.mocked(ctx.reply).mock.calls[0][0];
    expect(replyText).toBeTypeOf("string");
    expect(replyText.length).toBeGreaterThan(0);
  });

  it("refuses a plan without the mentor feature BEFORE touching the mode", async () => {
    const ctx = createMockCtx(undefined, { featureAccess: denyAll });
    await handleMentorCommand(ctx);
    // The user is not trapped in a gated mode: mode untouched, nothing persisted.
    expect(ctx.session.activeMode).toBe("translate");
    expect(mockUserRepository.updateActiveMode).not.toHaveBeenCalled();
    expect(ctx.session.mentor).toBeUndefined();
    // The refusal is the upgrade screen, not silence.
    expect(ctx.reply).toHaveBeenCalled();
  });
});
