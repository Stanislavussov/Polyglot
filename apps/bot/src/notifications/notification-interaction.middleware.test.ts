import { beforeEach, describe, expect, it, vi } from "vitest";

const recordInteraction = vi.hoisted(() => vi.fn());

vi.mock("@polyglot/adapter-db", () => ({
  notificationDeliveryRepository: { recordInteraction },
}));

const { notificationInteractionMiddleware } = await import("./notification-interaction.middleware.js");

function tapCtx(chatType = "private"): never {
  return {
    user: { id: 7 },
    callbackQuery: { data: "notif:reveal:42", message: { message_id: 800, chat: { type: chatType } } },
  } as never;
}

beforeEach(() => {
  recordInteraction.mockReset();
  recordInteraction.mockResolvedValue({ deliveryId: 3, kind: "word_card" });
});

describe("notificationInteractionMiddleware", () => {
  it("records the tapped button against the tapped message, after the handler ran", async () => {
    const order: string[] = [];
    recordInteraction.mockImplementation(async () => {
      order.push("record");
      return null;
    });

    await notificationInteractionMiddleware(tapCtx(), async () => {
      order.push("handler");
    });

    expect(order).toEqual(["handler", "record"]);
    expect(recordInteraction).toHaveBeenCalledWith({ userId: 7, telegramMessageId: 800, action: "notif:reveal:42" });
  });

  it("ignores updates that are not button taps", async () => {
    const next = vi.fn(async () => {});

    await notificationInteractionMiddleware({ user: { id: 7 }, message: { text: "Haus" } } as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(recordInteraction).not.toHaveBeenCalled();
  });

  it.each([
    ["a group chat, where message ids collide with the private chat's", tapCtx("group")],
    ["an inline message, which has no chat message", { user: { id: 7 }, callbackQuery: { data: "x" } } as never],
    [
      "an update auth left without a user",
      { callbackQuery: { data: "x", message: { message_id: 1, chat: { type: "private" } } } } as never,
    ],
  ])("records nothing for a tap on %s", async (_case, ctx) => {
    await notificationInteractionMiddleware(ctx, async () => {});

    expect(recordInteraction).not.toHaveBeenCalled();
  });

  it("still records the tap when the handler throws, and re-throws the handler's error", async () => {
    const failure = new Error("handler failed");

    await expect(
      notificationInteractionMiddleware(tapCtx(), async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(recordInteraction).toHaveBeenCalledOnce();
  });

  it("never fails the tap when the journal write fails", async () => {
    recordInteraction.mockRejectedValue(new Error("connection terminated"));

    await expect(notificationInteractionMiddleware(tapCtx(), async () => {})).resolves.toBeUndefined();
  });
});
