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

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
  getLangDisplay: vi.fn((lang: string) => lang),
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
});

import type { BotContext, SessionData } from "../types.js";
import { handleMentorCommand } from "./mentor.scene.js";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
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
    user: { id: 1, telegramId: 123456789, onboarded: true },
  } as unknown as BotContext;
}

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

  it("clears existing mentor history on entry", async () => {
    const ctx = createMockCtx({
      mentor: { history: [{ role: "user", content: "old message" }] },
    });
    await handleMentorCommand(ctx);
    expect(ctx.session.mentor).toBeUndefined();
  });

  it("replies with a confirmation message", async () => {
    const ctx = createMockCtx();
    await handleMentorCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = vi.mocked(ctx.reply).mock.calls[0][0];
    expect(replyText).toBeTypeOf("string");
    expect(replyText.length).toBeGreaterThan(0);
  });
});
