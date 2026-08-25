/**
 * Bot-boundary integration for AI fallback-model failover (Phase 2).
 *
 * A real call site (mentor mode) whose provider returns a retriable 429 on the
 * primary model must still deliver a coaching reply — produced on the fallback
 * model — instead of the user-facing error. Wires the REAL `withModelFailover`
 * (as the container does) over a faked provider seam so the failover logic is
 * exercised end-to-end without hitting the network.
 *
 * Lives in apps/bot/src/__tests__ (not scenes/**) because it imports
 * @polyglot/adapter-ai directly, which the scenes→adapters boundary rule forbids
 * inside scene/helper source — the failover unit under test is the adapter's, and
 * the container is what wires it into ctx.services for real traffic.
 */
import { setAIFallbackObserver, withModelFailover } from "@polyglot/adapter-ai";
import { resetBreakerRegistry } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository, mockSettings, mockTranslationRequestRepository, mockMentorMessageRepository } = vi.hoisted(
  () => ({
    mockMentorMessageRepository: {
      record: vi.fn().mockResolvedValue(undefined),
      findThreadByMessage: vi.fn().mockResolvedValue(null),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      findLatestThreadId: vi.fn().mockResolvedValue(null),
    },
    mockUserRepository: {
      getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["cs"] }),
      getLanguageLevels: vi.fn().mockResolvedValue([{ languageCode: "cs", proficiencyLevel: "B2" }]),
    },
    mockSettings: {
      getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-4o"),
      getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-4o"),
      getMentorConfig: vi.fn().mockResolvedValue({ modelId: "", maxTokens: 700 }),
      getPlanLimit: vi.fn().mockResolvedValue({
        name: "free",
        label: "Free",
        translationLimit: 50,
        creditCost: 1,
        isActive: true,
        isDefault: true,
      }),
    },
    mockTranslationRequestRepository: {
      getUserCreditsInWindow: vi.fn().mockResolvedValue(0),
      logTranslationRequest: vi.fn().mockResolvedValue(1),
    },
  }),
);

vi.mock("../metrics.js", () => ({
  mentorCounter: { inc: vi.fn() },
  mentorDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
}));

import { mentorCounter } from "../metrics.js";
import { handleMentorText } from "../scenes/helpers/mentor-mode.helper.js";
import type { BotContext, SessionData } from "../types.js";

/** The admin-configured failover model this suite routes the second attempt to. */
const ADMIN_FALLBACK_MODEL = "openai/gpt-5-nano";

/** The provider seam: primary (1st call) 429s; the fallback model (2nd call) succeeds. */
function buildFailoverAi(provider: (model: string) => Promise<string>) {
  return {
    generateChat: (_messages: unknown, model: string) =>
      withModelFailover(
        {
          primaryModel: model,
          fallbackModel: ADMIN_FALLBACK_MODEL,
          primaryBudgetMs: 10_000,
          reservedFallbackMs: 5_000,
        },
        (attemptModel: string) => provider(attemptModel),
      ),
  };
}

function createMockCtx(ai: ReturnType<typeof buildFailoverAi>): BotContext {
  const session: SessionData = { activeMode: "mentor", mentor: undefined } as SessionData;
  return {
    from: { id: 123456789 },
    chat: { id: 123456789 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    user: { id: 1, telegramId: 123456789, onboarded: true, subscriptionPlan: "free" },
    services: {
      userRepository: mockUserRepository,
      ai,
      settings: mockSettings,
      translationRequestRepository: mockTranslationRequestRepository,
      mentorMessageRepository: mockMentorMessageRepository,
    },
    api: { deleteMessage: vi.fn().mockResolvedValue(undefined) },
  } as unknown as BotContext;
}

describe("handleMentorText with failover", () => {
  const observer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetBreakerRegistry();
    observer.mockClear();
    setAIFallbackObserver(observer);
  });

  afterEach(() => {
    setAIFallbackObserver(null);
    resetBreakerRegistry();
  });

  it("delivers a fallback coaching reply when the primary model 429s", async () => {
    const provider = vi
      .fn<(model: string) => Promise<string>>()
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValueOnce("Fallback coach: what do you think it means?");
    const ctx = createMockCtx(buildFailoverAi(provider));

    await handleMentorText(ctx, "What does banka mean?");

    // The primary (openai/gpt-4o) 429d; the fallback model produced the reply.
    expect(provider).toHaveBeenNthCalledWith(1, "openai/gpt-4o");
    expect(provider).toHaveBeenNthCalledWith(2, ADMIN_FALLBACK_MODEL);

    // User got the coaching reply (loading indicator first, then the answer) — no error.
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toBe("Fallback coach: what do you think it means?");
    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "success" });

    // The failover was counted for the metric.
    expect(observer).toHaveBeenCalledWith({
      fromModel: "openai/gpt-4o",
      toModel: ADMIN_FALLBACK_MODEL,
      reason: "rate_limit",
    });
  });
});
