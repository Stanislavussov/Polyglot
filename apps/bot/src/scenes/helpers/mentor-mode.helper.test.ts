import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository, mockAi, mockSettings, mockTranslationRequestRepository } = vi.hoisted(() => ({
  mockUserRepository: {
    getSettings: vi.fn().mockResolvedValue({
      interfaceLang: "en",
      nativeLang: "en",
      learningLangs: ["cs"],
    }),
  },
  mockAi: {
    generateChat: vi.fn().mockResolvedValue("What do you think it means?"),
  },
  mockSettings: {
    getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-4o"),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-4o"),
    getPlanLimit: vi.fn().mockResolvedValue(null),
  },
  mockTranslationRequestRepository: {
    getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
    logTranslationRequest: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: mockUserRepository,
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
});

vi.mock("../../metrics.js", () => ({
  mentorCounter: { inc: vi.fn() },
  mentorDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
}));

import { MAX_MENTOR_HISTORY } from "@polyglot/core";
import { mentorCounter } from "../../metrics.js";
import type { BotContext, SessionData } from "../../types.js";
import { handleMentorText } from "./mentor-mode.helper.js";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
  const session: SessionData = {
    activeMode: "mentor",
    mentor: undefined,
    ...overrides,
  } as SessionData;
  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    user: { id: 1, telegramId: 123456789, onboarded: true, subscriptionPlan: "free" },
    services: {
      userRepository: mockUserRepository,
      ai: mockAi,
      settings: mockSettings,
      translationRequestRepository: mockTranslationRequestRepository,
    },
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("handleMentorText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateChat with system prompt, history, and user message", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "What does banka mean?");

    expect(mockAi.generateChat).toHaveBeenCalledTimes(1);
    const args = vi.mocked(mockAi.generateChat).mock.calls[0];
    const messages = args[0];
    // First message is the system prompt
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Polyglot Mentor");
    // Last message is the user's text
    expect(messages[messages.length - 1]).toEqual({
      role: "user",
      content: "What does banka mean?",
    });
  });

  it("passes maxTokens to limit response length", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    const options = vi.mocked(mockAi.generateChat).mock.calls[0][2];
    expect(options?.maxTokens).toBeTypeOf("number");
    expect(options?.maxTokens).toBeLessThanOrEqual(500);
  });

  it("replies with the AI response text", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    // First reply is the loading indicator, second is the actual response
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toBe("What do you think it means?");
  });

  it("deletes the loading indicator after success", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(123456789, 100);
  });

  it("stores user and assistant messages in session history", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "What does banka mean?");

    expect(ctx.session.mentor?.history).toEqual([
      { role: "user", content: "What does banka mean?" },
      { role: "assistant", content: "What do you think it means?" },
    ]);
  });

  it("includes previous history in the messages array", async () => {
    const ctx = createMockCtx({
      mentor: {
        history: [
          { role: "user", content: "previous question" },
          { role: "assistant", content: "previous answer" },
        ],
      },
    });
    await handleMentorText(ctx, "new question");

    const messages = vi.mocked(mockAi.generateChat).mock.calls[0][0];
    // system + 2 history + 1 new user message = 4 messages
    expect(messages.length).toBe(4);
    expect(messages[1]).toEqual({ role: "user", content: "previous question" });
    expect(messages[2]).toEqual({ role: "assistant", content: "previous answer" });
    expect(messages[3]).toEqual({ role: "user", content: "new question" });
  });

  it("trims history to MAX_MENTOR_HISTORY entries", async () => {
    // Pre-fill history with more than MAX_MENTOR_HISTORY entries
    const oldHistory = Array.from({ length: MAX_MENTOR_HISTORY + 4 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg ${i}`,
    }));
    const ctx = createMockCtx({ mentor: { history: oldHistory } });
    await handleMentorText(ctx, "new message");

    expect(ctx.session.mentor?.history.length).toBe(MAX_MENTOR_HISTORY);
    // The oldest entries should be trimmed, newest kept
    expect(ctx.session.mentor?.history[ctx.session.mentor!.history.length - 1]).toEqual({
      role: "assistant",
      content: "What do you think it means?",
    });
  });

  it("increments mentorCounter with success status on success", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "success" });
  });

  it("replies with an error message when AI call fails", async () => {
    mockAi.generateChat.mockRejectedValueOnce(new Error("API down"));
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    // Loading indicator + error message
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toMatch(/error|failed/i);
  });

  it("increments mentorCounter with error status on failure", async () => {
    mockAi.generateChat.mockRejectedValueOnce(new Error("API down"));
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "error" });
  });

  it("rejects input longer than the max character limit", async () => {
    const ctx = createMockCtx();
    const longText = "a".repeat(2000);
    await handleMentorText(ctx, longText);

    // Should NOT call AI
    expect(mockAi.generateChat).not.toHaveBeenCalled();
    // Should reply with a warning
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(1);
    expect(replies[0][0]).toMatch(/short|long|character|limit/i);
  });

  it("refuses the mentor call when the daily credit quota is exhausted (T16)", async () => {
    // Free plan = 50 credits/day; already at the limit.
    mockTranslationRequestRepository.getUserCreditsInWindow.mockResolvedValueOnce(50);
    const ctx = createMockCtx();

    await handleMentorText(ctx, "help me learn");

    // No paid call, and nothing billed.
    expect(mockAi.generateChat).not.toHaveBeenCalled();
    expect(mockTranslationRequestRepository.logTranslationRequest).not.toHaveBeenCalled();
  });

  it("bills a mentor turn against the shared credit ledger on success (T16)", async () => {
    const ctx = createMockCtx();

    await handleMentorText(ctx, "help me learn");

    expect(mockAi.generateChat).toHaveBeenCalledTimes(1);
    // A mentor turn costs AI_CALL_WEIGHTS.mentor (2) credits.
    expect(mockTranslationRequestRepository.logTranslationRequest).toHaveBeenCalledWith(1, "[mentor]", null, [], 2);
  });
});
