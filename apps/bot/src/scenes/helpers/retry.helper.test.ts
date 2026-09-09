import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./translate-flow.js", () => ({ handleTranslateText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./mentor-mode.helper.js", () => ({ handleMentorText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../middlewares/request-settings.js", () => ({
  getRequestSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["de"] }),
}));

import type { BotContext, SessionData } from "../../types.js";
import { setRetryAction } from "../../utils/retry-action.js";
import { handleMentorText } from "./mentor-mode.helper.js";
import { handleRetryCallback } from "./retry.helper.js";
import { handleTranslateText } from "./translate-flow.js";

const NOTICE_MSG_ID = 777;
const CHAT_ID = 123456789;

function createMockCtx(): BotContext & { session: SessionData } {
  const session = { activeMode: "translate" } as SessionData;
  return {
    from: { id: CHAT_ID },
    chat: { id: CHAT_ID },
    session,
    user: { id: 1, telegramId: CHAT_ID, onboarded: true, subscriptionPlan: "free" },
    callbackQuery: { data: "retry", message: { message_id: NOTICE_MSG_ID } },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
    services: {},
  } as unknown as BotContext & { session: SessionData };
}

describe("handleRetryCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-runs the translation with the original input", async () => {
    const ctx = createMockCtx();
    setRetryAction(ctx.session, NOTICE_MSG_ID, { kind: "translate", text: "Haus :: building" });

    await handleRetryCallback(ctx);

    expect(handleTranslateText).toHaveBeenCalledWith(ctx, "Haus :: building");
    expect(handleMentorText).not.toHaveBeenCalled();
  });

  it("re-runs the mentor turn with the original message and its thread", async () => {
    const ctx = createMockCtx();
    setRetryAction(ctx.session, NOTICE_MSG_ID, {
      kind: "mentor",
      text: "what does banka mean?",
      threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    await handleRetryCallback(ctx);

    expect(handleMentorText).toHaveBeenCalledWith(ctx, "what does banka mean?", {
      threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(handleTranslateText).not.toHaveBeenCalled();
  });

  it("acks the callback and deletes the notice before re-running", async () => {
    const ctx = createMockCtx();
    setRetryAction(ctx.session, NOTICE_MSG_ID, { kind: "translate", text: "Haus" });

    await handleRetryCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(CHAT_ID, NOTICE_MSG_ID);
  });

  it("does not launch a second run when the same button is tapped twice", async () => {
    const ctx = createMockCtx();
    setRetryAction(ctx.session, NOTICE_MSG_ID, { kind: "translate", text: "Haus" });

    await handleRetryCallback(ctx);
    await handleRetryCallback(ctx);

    expect(handleTranslateText).toHaveBeenCalledTimes(1);
  });

  it("reports an expired session and drops the dead button when the action is gone", async () => {
    // Bot restart / eviction: the button outlived its session entry.
    const ctx = createMockCtx();

    await handleRetryCallback(ctx);

    expect(handleTranslateText).not.toHaveBeenCalled();
    expect(handleMentorText).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/expired/i), show_alert: true }),
    );
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });

  it("survives a failing ack and still re-runs the operation", async () => {
    const ctx = createMockCtx();
    vi.mocked(ctx.answerCallbackQuery).mockRejectedValueOnce(new Error("query is too old"));
    setRetryAction(ctx.session, NOTICE_MSG_ID, { kind: "translate", text: "Haus" });

    await handleRetryCallback(ctx);

    expect(handleTranslateText).toHaveBeenCalledWith(ctx, "Haus");
  });
});
