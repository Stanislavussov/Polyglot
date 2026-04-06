/**
 * Tests for notification callback handlers (notif:open, notif:skip).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

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
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleNotifOpenCallback", () => {
  it("removes keyboard and sends /dictionary deep-link", async () => {
    const ctx = createMockCtx();

    await handleNotifOpenCallback(ctx);

    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      reply_markup: { inline_keyboard: [] },
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(12345, "/dictionary");
  });

  it("handles missing from.id gracefully", async () => {
    const ctx = createMockCtx();
    ctx.from = undefined;

    await handleNotifOpenCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("handles editMessageReplyMarkup error gracefully", async () => {
    const ctx = createMockCtx();
    ctx.editMessageReplyMarkup.mockRejectedValue(new Error("too old"));

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
