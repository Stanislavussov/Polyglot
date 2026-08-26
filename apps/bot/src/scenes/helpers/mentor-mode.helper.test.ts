import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository, mockAi, mockSettings, mockTranslationRequestRepository, mockMentorMessageRepository } =
  vi.hoisted(() => ({
    mockUserRepository: {
      getSettings: vi.fn().mockResolvedValue({
        interfaceLang: "en",
        nativeLang: "en",
        learningLangs: ["cs"],
      }),
      getLanguageLevels: vi.fn().mockResolvedValue([{ languageCode: "cs", proficiencyLevel: "A2" }]),
    },
    mockAi: {
      generateChat: vi.fn().mockResolvedValue("Present Perfect links past events to now."),
    },
    mockSettings: {
      getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-4o"),
      getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-4o"),
      getFallbackAIModel: vi.fn().mockResolvedValue(null),
      getMentorConfig: vi.fn().mockResolvedValue({ modelId: "", maxTokens: 700 }),
      getPlanLimit: vi.fn().mockResolvedValue({
        name: "free",
        label: "Free",
        translationLimit: 50,
        creditCost: 1,
        mentorDailyLimit: null,
        isActive: true,
        isDefault: true,
      }),
    },
    mockTranslationRequestRepository: {
      getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
      countRequestsInWindow: vi.fn().mockResolvedValue(0),
      logTranslationRequest: vi.fn().mockResolvedValue(1),
    },
    mockMentorMessageRepository: {
      record: vi.fn().mockResolvedValue(undefined),
      findThreadByMessage: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      findLatestThreadId: vi.fn().mockResolvedValue(null),
    },
  }));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return { ...actual };
});

vi.mock("../../metrics.js", () => ({
  mentorCounter: { inc: vi.fn() },
  mentorDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
}));

import { AITimeoutError, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import { mentorCounter } from "../../metrics.js";
import type { BotContext, SessionData } from "../../types.js";
import { RETRY_CALLBACK, takeRetryAction } from "../../utils/retry-action.js";
import { handleMentorText } from "./mentor-mode.helper.js";

const THREAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THREAD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
  const session: SessionData = {
    activeMode: "mentor",
    mentor: undefined,
    ...overrides,
  } as SessionData;
  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    // The momentum credit for a mentor turn is keyed by `update_id` (Task 81 §3.8).
    update: { update_id: 555 },
    message: { message_id: 55, text: "irrelevant" },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    user: { id: 1, telegramId: 123456789, onboarded: true, audienceGroup: "product", subscriptionPlan: "free" },
    services: {
      userRepository: mockUserRepository,
      ai: mockAi,
      settings: mockSettings,
      translationRequestRepository: mockTranslationRequestRepository,
      mentorMessageRepository: mockMentorMessageRepository,
    },
    api: {
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as BotContext;
}

describe("handleMentorText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMentorMessageRepository.getRecentMessages.mockResolvedValue([]);
    mockMentorMessageRepository.findLatestThreadId.mockResolvedValue(null);
  });

  it("calls generateChat with system prompt, thread history from the DB, and the user message", async () => {
    mockMentorMessageRepository.getRecentMessages.mockResolvedValueOnce([
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ]);
    const ctx = createMockCtx({ mentor: { threadId: THREAD_A } });
    await handleMentorText(ctx, "new question");

    expect(mockMentorMessageRepository.getRecentMessages).toHaveBeenCalledWith(THREAD_A, expect.any(Number));
    const messages = vi.mocked(mockAi.generateChat).mock.calls[0][0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Polyglot Mentor");
    expect(messages[1]).toEqual({ role: "user", content: "previous question" });
    expect(messages[2]).toEqual({ role: "assistant", content: "previous answer" });
    expect(messages[3]).toEqual({ role: "user", content: "new question" });
  });

  it("annotates the learning language in the system prompt with the user's stored CEFR level", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "how does the locative work?");

    const messages = vi.mocked(mockAi.generateChat).mock.calls[0][0];
    expect(messages[0].content).toContain("cs (A2)");
  });

  it("passes maxTokens and a time budget to the chat call", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    const options = vi.mocked(mockAi.generateChat).mock.calls[0][2];
    expect(options?.maxTokens).toBeTypeOf("number");
    expect(options?.maxTokens).toBeLessThanOrEqual(1024);
    expect(options?.budgetMs).toBeGreaterThan(0);
  });

  it("replies with the AI response as Telegram HTML, carrying the exit button in mentor mode", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    // First reply is the loading indicator, second is the actual response
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toBe("Present Perfect links past events to now.");
    const extra = replies[1][1] as { parse_mode?: string; reply_markup?: { inline_keyboard: unknown[] } };
    expect(extra?.parse_mode).toBe("HTML");
    expect(extra?.reply_markup?.inline_keyboard).toBeDefined();
  });

  it("delivers the answer as plain text when Telegram rejects the HTML markup", async () => {
    const ctx = createMockCtx();
    vi.mocked(ctx.reply)
      .mockResolvedValueOnce({ message_id: 90 } as never) // loader
      .mockRejectedValueOnce(new Error("can't parse entities")) // HTML attempt
      .mockResolvedValueOnce({ message_id: 100 } as never); // plain fallback

    await handleMentorText(ctx, "hello");

    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(3);
    expect(replies[2][0]).toBe("Present Perfect links past events to now.");
    expect((replies[2][1] as { parse_mode?: string })?.parse_mode).toBeUndefined();
  });

  it("sends the answer without the exit button when the turn ran outside mentor mode", async () => {
    const ctx = createMockCtx({ activeMode: "translate", mentor: undefined });
    await handleMentorText(ctx, "reply from translate", { threadId: THREAD_B });

    const extra = vi.mocked(ctx.reply).mock.calls[1][1] as { reply_markup?: unknown };
    expect(extra?.reply_markup).toBeUndefined();
  });

  it("deletes the loading indicator after success", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(123456789, 100);
  });

  it("persists both turn rows keyed by their Telegram message ids", async () => {
    const ctx = createMockCtx({ mentor: { threadId: THREAD_A } });
    await handleMentorText(ctx, "how do cases work?");

    expect(mockMentorMessageRepository.record).toHaveBeenCalledTimes(2);
    expect(mockMentorMessageRepository.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: "user",
        content: "how do cases work?",
        threadId: THREAD_A,
        telegramMessageId: 55,
      }),
    );
    expect(mockMentorMessageRepository.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: "assistant", threadId: THREAD_A, telegramMessageId: 100 }),
    );
  });

  it("still delivers the answer when persistence fails (best-effort write)", async () => {
    mockMentorMessageRepository.record.mockRejectedValueOnce(new Error("db down"));
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies[1][0]).toBe("Present Perfect links past events to now.");
    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "success" });
  });

  it("an explicit threadId (reply-continuation) wins over the session's pinned thread", async () => {
    const ctx = createMockCtx({ mentor: { threadId: THREAD_A } });
    await handleMentorText(ctx, "and in questions?", { threadId: THREAD_B });

    expect(mockMentorMessageRepository.getRecentMessages).toHaveBeenCalledWith(THREAD_B, expect.any(Number));
  });

  it("recovers the chat's latest thread from the DB when the session was lost in mentor mode", async () => {
    mockMentorMessageRepository.findLatestThreadId.mockResolvedValueOnce(THREAD_A);
    const ctx = createMockCtx({ mentor: undefined });
    await handleMentorText(ctx, "continue");

    expect(mockMentorMessageRepository.findLatestThreadId).toHaveBeenCalledWith(123456789);
    expect(mockMentorMessageRepository.getRecentMessages).toHaveBeenCalledWith(THREAD_A, expect.any(Number));
  });

  it("a fresh /mentor entry (empty marker) mints a new thread without DB recovery", async () => {
    const ctx = createMockCtx({ mentor: {} });
    await handleMentorText(ctx, "first question");

    expect(mockMentorMessageRepository.findLatestThreadId).not.toHaveBeenCalled();
    const threadId = mockMentorMessageRepository.record.mock.calls[0][0].threadId;
    expect(threadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.session.mentor).toEqual({ threadId });
  });

  it("does not pin the thread on the session when the turn ran outside mentor mode", async () => {
    const ctx = createMockCtx({ activeMode: "translate", mentor: undefined });
    await handleMentorText(ctx, "reply from translate mode", { threadId: THREAD_B });

    expect(ctx.session.mentor).toBeUndefined();
  });

  it("answers with the admin-configured mentor model, bypassing the default chain", async () => {
    mockSettings.getMentorConfig.mockResolvedValueOnce({ modelId: "anthropic/claude-sonnet-5", maxTokens: 900 });
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    const [, model, options] = vi.mocked(mockAi.generateChat).mock.calls[0];
    expect(model).toBe("anthropic/claude-sonnet-5");
    expect(options?.maxTokens).toBe(900);
    expect(mockSettings.getDefaultAIModel).not.toHaveBeenCalled();
  });

  it("falls back to the default model chain when the mentor override is empty", async () => {
    mockSettings.getMentorConfig.mockResolvedValueOnce({ modelId: "  ", maxTokens: 700 });
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    const [, model] = vi.mocked(mockAi.generateChat).mock.calls[0];
    expect(model).toBe("openai/gpt-4o");
  });

  it("refuses the turn when the plan's mentor daily limit is exhausted, without an AI call", async () => {
    mockSettings.getPlanLimit.mockResolvedValueOnce({
      name: "plus",
      label: "Plus",
      translationLimit: null,
      creditCost: 1,
      mentorDailyLimit: 30,
      isActive: true,
      isDefault: false,
    });
    mockTranslationRequestRepository.countRequestsInWindow.mockResolvedValueOnce(30);
    const ctx = createMockCtx();

    await handleMentorText(ctx, "one more question");

    expect(mockTranslationRequestRepository.countRequestsInWindow).toHaveBeenCalledWith(
      1,
      "[mentor]",
      expect.any(Date),
    );
    expect(mockAi.generateChat).not.toHaveBeenCalled();
    expect(mockTranslationRequestRepository.logTranslationRequest).not.toHaveBeenCalled();
    // The refusal names the limit and carries the upgrade keyboard.
    const [text, extra] = vi.mocked(ctx.reply).mock.calls[0];
    expect(text).toContain("30");
    expect(extra?.reply_markup).toBeDefined();
  });

  it("lets the turn through while the daily limit still has room", async () => {
    mockSettings.getPlanLimit.mockResolvedValueOnce({
      name: "plus",
      label: "Plus",
      translationLimit: null,
      creditCost: 1,
      mentorDailyLimit: 30,
      isActive: true,
      isDefault: false,
    });
    mockTranslationRequestRepository.countRequestsInWindow.mockResolvedValueOnce(29);
    const ctx = createMockCtx();

    await handleMentorText(ctx, "still allowed");

    expect(mockAi.generateChat).toHaveBeenCalledTimes(1);
  });

  it("never counts turns for an unlimited-mentor plan (null limit)", async () => {
    const ctx = createMockCtx();
    await handleMentorText(ctx, "hello");

    expect(mockTranslationRequestRepository.countRequestsInWindow).not.toHaveBeenCalled();
  });

  it("bypasses the mentor daily limit for internal roles (no plan read, no turn count)", async () => {
    // A free-plan admin with mentorDailyLimit 0 must still get through: the role
    // short-circuits before the count. (The queued plan is consumed by the credit
    // meter later in the same turn.)
    mockSettings.getPlanLimit.mockResolvedValueOnce({
      name: "free",
      label: "Free",
      translationLimit: 50,
      creditCost: 1,
      mentorDailyLimit: 0,
      isActive: true,
      isDefault: true,
    });
    const ctx = createMockCtx();
    (ctx.user as { audienceGroup: string }).audienceGroup = "admin";

    await handleMentorText(ctx, "hello");

    expect(mockTranslationRequestRepository.countRequestsInWindow).not.toHaveBeenCalled();
    expect(mockAi.generateChat).toHaveBeenCalledTimes(1);
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

  it("offers a retry button carrying the same turn and thread when the AI call times out", async () => {
    mockAi.generateChat.mockRejectedValueOnce(new AITimeoutError(15_000));
    const ctx = createMockCtx({ mentor: { threadId: THREAD_A } });

    await handleMentorText(ctx, "what does banka mean?");

    const [text, extra] = vi.mocked(ctx.reply).mock.calls[1] as [string, { reply_markup?: InlineKeyboardMarkup }];
    expect(text).toBe(t("loadingTimeout", "en"));
    expect(extra?.reply_markup?.inline_keyboard[0][0]).toMatchObject({ callback_data: RETRY_CALLBACK });
    expect(takeRetryAction(ctx.session, 100)).toMatchObject({
      kind: "mentor",
      text: "what does banka mean?",
      threadId: THREAD_A,
    });
  });

  it("does not offer a retry button on a hard AI failure", async () => {
    mockAi.generateChat.mockRejectedValueOnce(new Error("API down"));
    const ctx = createMockCtx();

    await handleMentorText(ctx, "hello");

    const extra = vi.mocked(ctx.reply).mock.calls[1][1];
    expect(extra).toBeUndefined();
    expect(ctx.session.pendingRetries).toBeUndefined();
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
