import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./translate-flow.js", () => ({ handleTranslateText: vi.fn().mockResolvedValue(undefined) }));
// Partial mock: the real MENTOR_MAX_INPUT_LENGTH is the boundary under test.
vi.mock("./mentor-mode.helper.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mentor-mode.helper.js")>()),
  handleMentorText: vi.fn().mockResolvedValue(undefined),
}));

import type { ServiceContainer } from "@polyglot/core";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../../types.js";
import {
  handleMentorIdleExitCallback,
  handleMentorIdleStayCallback,
  MENTOR_IDLE_EXIT_CALLBACK,
  MENTOR_IDLE_STAY_CALLBACK,
  maybePromptMentorIdle,
} from "./mentor-idle.helper.js";
import { handleMentorText, MENTOR_MAX_INPUT_LENGTH } from "./mentor-mode.helper.js";
import { handleTranslateText } from "./translate-flow.js";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const MINUTE = 60_000;
const CHAT_ID = 123456789;
const USER_MSG_ID = 555;
const PROMPT_MSG_ID = 4242;
const THREAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createMockCtx(overrides: Partial<SessionData> = {}): BotContext {
  const session = {
    activeMode: "mentor",
    mentor: { threadId: THREAD_ID, lastTurnAt: NOW.getTime() - 16 * MINUTE },
    ...overrides,
  } as SessionData;
  const userRepository = {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["cs"] }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  } as unknown as ServiceContainer["userRepository"];

  return {
    chat: { id: CHAT_ID },
    message: { message_id: USER_MSG_ID, text: "what does banka mean?" },
    session,
    user: { id: 1, telegramId: CHAT_ID, onboarded: true, subscriptionPlan: "plus" },
    reply: vi.fn().mockResolvedValue({ message_id: PROMPT_MSG_ID }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
    services: createServicesStub({ userRepository }),
  } as unknown as BotContext;
}

function keyboardCallbacks(ctx: BotContext): (string | undefined)[] {
  const [, extra] = vi.mocked(ctx.reply).mock.calls[0];
  const rows = extra?.reply_markup && "inline_keyboard" in extra.reply_markup ? extra.reply_markup.inline_keyboard : [];
  return rows[0].map((button) => ("callback_data" in button ? button.callback_data : undefined));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Date only: the idle window is measured with Date.now(), and faking the whole
  // timer set would stall nothing here but buys no coverage either.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("maybePromptMentorIdle", () => {
  it("asks which mode to continue in after a long silence, without spending an AI call", async () => {
    const ctx = createMockCtx();

    const prompted = await maybePromptMentorIdle(ctx, "what does banka mean?");

    expect(prompted).toBe(true);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(keyboardCallbacks(ctx)).toEqual([MENTOR_IDLE_STAY_CALLBACK, MENTOR_IDLE_EXIT_CALLBACK]);
    expect(handleMentorText).not.toHaveBeenCalled();
    expect(ctx.services.ai.generateChat).not.toHaveBeenCalled();
    expect(ctx.session.mentorIdlePrompt).toEqual({
      text: "what does banka mean?",
      userMsgId: USER_MSG_ID,
      promptMsgId: PROMPT_MSG_ID,
    });
  });

  it("stays out of the way inside the idle window", async () => {
    const ctx = createMockCtx({ mentor: { threadId: THREAD_ID, lastTurnAt: NOW.getTime() - 2 * MINUTE } });

    expect(await maybePromptMentorIdle(ctx, "and what about banku?")).toBe(false);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.session.mentorIdlePrompt).toBeUndefined();
  });

  it("never prompts on a session with no recorded mentor activity", async () => {
    const ctx = createMockCtx({ mentor: undefined });

    expect(await maybePromptMentorIdle(ctx, "what does banka mean?")).toBe(false);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("declines over-long input so the router falls through to the length rejection", async () => {
    const ctx = createMockCtx();

    expect(await maybePromptMentorIdle(ctx, "x".repeat(MENTOR_MAX_INPUT_LENGTH + 1))).toBe(false);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.session.mentorIdlePrompt).toBeUndefined();
  });

  it("leaves exactly one live prompt when a second message arrives", async () => {
    const ctx = createMockCtx({ mentorIdlePrompt: { text: "older question", userMsgId: 500, promptMsgId: 4000 } });
    vi.mocked(ctx.reply).mockResolvedValue({ message_id: 4243 } as Awaited<ReturnType<BotContext["reply"]>>);

    await maybePromptMentorIdle(ctx, "newer question");

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, 4000);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.session.mentorIdlePrompt).toEqual({
      text: "newer question",
      userMsgId: USER_MSG_ID,
      promptMsgId: 4243,
    });
  });

  it("holds nothing when the prompt never reaches the chat", async () => {
    const ctx = createMockCtx();
    vi.mocked(ctx.reply).mockRejectedValueOnce(new Error("bot was blocked by the user"));

    await expect(maybePromptMentorIdle(ctx, "what does banka mean?")).rejects.toThrow(/blocked/);

    // A hold whose buttons never arrived is unreachable — the next message re-prompts.
    expect(ctx.session.mentorIdlePrompt).toBeUndefined();
  });
});

describe("handleMentorIdleStayCallback", () => {
  it("resumes the held message in the pinned thread and keeps the user in mentor mode", async () => {
    const ctx = createMockCtx({
      mentorIdlePrompt: { text: "what does banka mean?", userMsgId: USER_MSG_ID, promptMsgId: PROMPT_MSG_ID },
    });

    await handleMentorIdleStayCallback(ctx);

    expect(handleMentorText).toHaveBeenCalledWith(ctx, "what does banka mean?", { userMessageId: USER_MSG_ID });
    expect(ctx.session.mentor).toEqual({ threadId: THREAD_ID, lastTurnAt: expect.any(Number) });
    expect(ctx.session.mentorIdlePrompt).toBeUndefined();
    expect(ctx.session.activeMode).toBe("mentor");
    expect(ctx.services.userRepository.updateActiveMode).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
  });

  it("does not launch a second paid turn when the button is tapped twice", async () => {
    const ctx = createMockCtx({
      mentorIdlePrompt: { text: "what does banka mean?", userMsgId: USER_MSG_ID, promptMsgId: PROMPT_MSG_ID },
    });

    await handleMentorIdleStayCallback(ctx);
    await handleMentorIdleStayCallback(ctx);

    expect(handleMentorText).toHaveBeenCalledTimes(1);
  });

  it("survives a message too old to edit (48h limit) and still runs the turn", async () => {
    const ctx = createMockCtx({
      mentorIdlePrompt: { text: "what does banka mean?", promptMsgId: PROMPT_MSG_ID },
    });
    vi.mocked(ctx.editMessageReplyMarkup).mockRejectedValueOnce(new Error("message to edit not found"));

    await handleMentorIdleStayCallback(ctx);

    expect(handleMentorText).toHaveBeenCalled();
  });

  it("reports an expired prompt and keeps the thread pin so the next message continues it", async () => {
    const ctx = createMockCtx();

    await handleMentorIdleStayCallback(ctx);

    expect(handleMentorText).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/expired/i), show_alert: true }),
    );
    expect(ctx.session.mentor).toEqual({ threadId: THREAD_ID, lastTurnAt: NOW.getTime() });
  });

  it("leaves a lost session lost on an expired prompt, so DB thread recovery still works", async () => {
    const ctx = createMockCtx({ mentor: undefined });

    await handleMentorIdleStayCallback(ctx);

    expect(ctx.session.mentor).toBeUndefined();
    expect(handleMentorText).not.toHaveBeenCalled();
  });
});

describe("handleMentorIdleExitCallback", () => {
  it("switches to translate mode and translates the held message", async () => {
    const ctx = createMockCtx({
      mentorIdlePrompt: { text: "what does banka mean?", userMsgId: USER_MSG_ID, promptMsgId: PROMPT_MSG_ID },
    });

    await handleMentorIdleExitCallback(ctx);

    expect(ctx.session.activeMode).toBe("translate");
    expect(ctx.services.userRepository.updateActiveMode).toHaveBeenCalledWith(1, "translate");
    expect(ctx.session.mentor).toBeUndefined();
    // The hold is taken before activateTranslateMode clears the slot.
    expect(handleTranslateText).toHaveBeenCalledWith(ctx, "what does banka mean?");
    expect(ctx.session.mentorIdlePrompt).toBeUndefined();
    expect(handleMentorText).not.toHaveBeenCalled();
  });

  it("still switches when the prompt has expired, with nothing to translate", async () => {
    const ctx = createMockCtx();

    await handleMentorIdleExitCallback(ctx);

    expect(ctx.session.activeMode).toBe("translate");
    expect(handleTranslateText).not.toHaveBeenCalled();
    expect(ctx.services.ai.generateChat).not.toHaveBeenCalled();
  });

  it("switches even when the tapped message is too old to edit (48h limit)", async () => {
    const ctx = createMockCtx({
      mentorIdlePrompt: { text: "what does banka mean?", promptMsgId: PROMPT_MSG_ID },
    });
    vi.mocked(ctx.editMessageReplyMarkup).mockRejectedValueOnce(new Error("message to edit not found"));

    await handleMentorIdleExitCallback(ctx);

    expect(ctx.session.activeMode).toBe("translate");
    expect(handleTranslateText).toHaveBeenCalledWith(ctx, "what does banka mean?");
  });
});
