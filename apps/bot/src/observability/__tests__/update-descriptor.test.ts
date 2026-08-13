import type { Context } from "grammy";
import { describe, expect, it } from "vitest";
import { describeUpdate } from "../update-descriptor.js";

/** Minimal stand-in for the parts of the context the descriptor reads. */
function ctxOf(parts: Partial<Context>): Context {
  return parts as Context;
}

describe("describeUpdate", () => {
  it("captures a typed command with its full text", () => {
    const descriptor = describeUpdate(
      ctxOf({
        update: { update_id: 1, message: {} } as Context["update"],
        message: { message_id: 10, text: "/translate Haus" } as Context["message"],
        chat: { id: 5, type: "private" } as Context["chat"],
      }),
    );

    expect(descriptor).toMatchObject({
      updateType: "message",
      command: "/translate",
      text: "/translate Haus",
      textLength: 15,
      messageId: 10,
      chatType: "private",
    });
  });

  it("records the verbatim callback payload and its family, so a dead button is identifiable", () => {
    const descriptor = describeUpdate(
      ctxOf({
        update: { update_id: 2, callback_query: {} } as Context["update"],
        callbackQuery: { data: "dict:view:1234" } as Context["callbackQuery"],
      }),
    );

    expect(descriptor).toMatchObject({
      updateType: "callback_query",
      callbackData: "dict:view:1234",
      callbackFamily: "dict",
    });
    expect(descriptor.command).toBeUndefined();
  });

  it("keeps the message text verbatim so a failing translation input can be replayed", () => {
    const descriptor = describeUpdate(
      ctxOf({
        update: { update_id: 3, message: {} } as Context["update"],
        message: { message_id: 11, text: "die Bank" } as Context["message"],
      }),
    );

    expect(descriptor.text).toBe("die Bank");
    expect(descriptor.command).toBeUndefined();
  });

  it("names the attachment kind for a non-text message", () => {
    const descriptor = describeUpdate(
      ctxOf({
        update: { update_id: 4, message: {} } as Context["update"],
        message: { message_id: 12, voice: { file_id: "abc" } } as unknown as Context["message"],
      }),
    );

    expect(descriptor).toMatchObject({ updateType: "message", contentType: "voice" });
    expect(descriptor.text).toBeUndefined();
  });

  it("describes an edited message from the edit payload", () => {
    const descriptor = describeUpdate(
      ctxOf({
        update: { update_id: 5, edited_message: {} } as Context["update"],
        editedMessage: { message_id: 13, text: "corrected" } as Context["editedMessage"],
      }),
    );

    expect(descriptor).toMatchObject({ updateType: "edited_message", text: "corrected", messageId: 13 });
  });

  it("reports an update kind the bot has no handler for by its real Telegram name", () => {
    // Deriving the type from the payload key means unhandled kinds stay
    // identifiable instead of collapsing into a catch-all bucket.
    const descriptor = describeUpdate(
      ctxOf({ update: { update_id: 6, my_chat_member: {} } as unknown as Context["update"] }),
    );

    expect(descriptor.updateType).toBe("my_chat_member");
  });

  it("survives an update with no message, chat or sender", () => {
    expect(() => describeUpdate(ctxOf({}))).not.toThrow();
    expect(describeUpdate(ctxOf({})).updateType).toBe("unknown");
  });
});
