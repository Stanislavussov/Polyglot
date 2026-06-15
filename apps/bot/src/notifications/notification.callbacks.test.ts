/**
 * Tests for notification callback handlers (notif:open, notif:skip).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../scenes/dictionary.scene.js", () => ({
  handleDictionaryCommand: vi.fn().mockResolvedValue(undefined),
}));

import { handleDictionaryCommand } from "../scenes/dictionary.scene.js";
import { handleNotifOpenCallback, handleNotifSkipCallback } from "./notification.callbacks.js";

function createMockCtx() {
  return {
    user: { id: 1 },
    from: { id: 12345 },
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
    },
    callbackQuery: { data: "", message: { message_id: 100 } },
    editMessageReplyMarkup: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
    reply: vi.fn().mockResolvedValue({ message_id: 200 }),
    session: {},
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleNotifOpenCallback", () => {
  it("removes keyboard and calls handleDictionaryCommand directly", async () => {
    const ctx = createMockCtx();

    await handleNotifOpenCallback(ctx);

    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(handleDictionaryCommand).toHaveBeenCalledWith(ctx);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("handles editMessageReplyMarkup error gracefully", async () => {
    const ctx = createMockCtx();
    ctx.editMessageReplyMarkup.mockRejectedValue(new Error("too old"));

    await handleNotifOpenCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(handleDictionaryCommand).toHaveBeenCalledWith(ctx);
  });

  it("handles handleDictionaryCommand error gracefully", async () => {
    const ctx = createMockCtx();
    vi.mocked(handleDictionaryCommand).mockRejectedValueOnce(new Error("db error"));

    await handleNotifOpenCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});

describe("handleNotifSkipCallback", () => {
  it("removes keyboard and answers callback", async () => {
    const ctx = createMockCtx();

    await handleNotifSkipCallback(ctx);

    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("handles editMessageReplyMarkup error gracefully", async () => {
    const ctx = createMockCtx();
    ctx.editMessageReplyMarkup.mockRejectedValue(new Error("too old"));

    await handleNotifSkipCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});
