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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUserRepository, mockSettings, mockTranslationRequestRepository } = vi.hoisted(() => ({
  mockUserRepository: {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["cs"] }),
  },
  mockSettings: {
    getDefaultAIModel: vi.fn().mockResolvedValue("openai/gpt-4o"),
    getDefaultAIModelForPlan: vi.fn().mockResolvedValue("openai/gpt-4o"),
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
}));

vi.mock("../metrics.js", () => ({
  mentorCounter: { inc: vi.fn() },
  mentorDuration: { startTimer: vi.fn().mockReturnValue(() => undefined) },
}));

import { mentorCounter } from "../metrics.js";
import { handleMentorText } from "../scenes/helpers/mentor-mode.helper.js";
import type { BotContext, SessionData } from "../types.js";
import { FALLBACK_AI_MODEL } from "../utils/ai-model.js";

/** The provider seam: primary (1st call) 429s; the fallback model (2nd call) succeeds. */
function buildFailoverAi(provider: (model: string) => Promise<string>) {
  return {
    generateChat: (_messages: unknown, model: string) =>
      withModelFailover(
        { primaryModel: model, fallbackModel: FALLBACK_AI_MODEL, primaryBudgetMs: 10_000, reservedFallbackMs: 5_000 },
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
    },
    api: { deleteMessage: vi.fn().mockResolvedValue(undefined) },
  } as unknown as BotContext;
}

describe("handleMentorText with failover", () => {
  const observer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    observer.mockClear();
    setAIFallbackObserver(observer);
  });

  afterEach(() => {
    setAIFallbackObserver(null);
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
    expect(provider).toHaveBeenNthCalledWith(2, FALLBACK_AI_MODEL);

    // User got the coaching reply (loading indicator first, then the answer) — no error.
    const replies = vi.mocked(ctx.reply).mock.calls;
    expect(replies.length).toBe(2);
    expect(replies[1][0]).toBe("Fallback coach: what do you think it means?");
    expect(mentorCounter.inc).toHaveBeenCalledWith({ status: "success" });

    // The failover was counted for the metric.
    expect(observer).toHaveBeenCalledWith({
      fromModel: "openai/gpt-4o",
      toModel: FALLBACK_AI_MODEL,
      reason: "rate_limit",
    });
  });
});
