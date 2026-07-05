import { GrammyError } from "grammy";
import { describe, expect, it, vi } from "vitest";
import type { BotContext } from "../../types.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "./edit-message.helper.js";

/** Build a real GrammyError the way grammy does when the Bot API returns 400. */
function grammyError(description: string, errorCode = 400): GrammyError {
  return new GrammyError(
    `Call to 'editMessageText' failed! (${errorCode}: ${description})`,
    { ok: false, error_code: errorCode, description },
    "editMessageText",
    {},
  );
}

/** Minimal BotContext with editMessageText/editMessageReplyMarkup/reply spies. */
function fakeCtx(editImpl: () => Promise<unknown> = () => Promise.resolve(true)) {
  const editMessageText = vi.fn(editImpl);
  const editMessageReplyMarkup = vi.fn(editImpl);
  const reply = vi.fn(() => Promise.resolve());
  const ctx = { editMessageText, editMessageReplyMarkup, reply } as unknown as BotContext;
  return { ctx, editMessageText, editMessageReplyMarkup, reply };
}

describe("editMessageTextOrReply", () => {
  it("edits the message in place on the happy path and does not send a new message", async () => {
    const { ctx, editMessageText, reply } = fakeCtx();
    const opts = { parse_mode: "HTML" as const };

    await editMessageTextOrReply(ctx, "hello", opts);

    expect(editMessageText).toHaveBeenCalledWith("hello", opts);
    expect(reply).not.toHaveBeenCalled();
  });

  it("swallows 'message is not modified' without sending a new message", async () => {
    const { ctx, reply } = fakeCtx(() => Promise.reject(grammyError("Bad Request: message is not modified")));

    await expect(editMessageTextOrReply(ctx, "hello")).resolves.toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
  });

  it("falls back to reply with the same text + options when the message is too old to edit", async () => {
    const { ctx, reply } = fakeCtx(() => Promise.reject(grammyError("Bad Request: message to edit not found")));
    const opts = { parse_mode: "HTML" as const };

    await editMessageTextOrReply(ctx, "restored", opts);

    expect(reply).toHaveBeenCalledWith("restored", opts);
  });

  it("falls back to reply when the message can't be edited", async () => {
    const { ctx, reply } = fakeCtx(() => Promise.reject(grammyError("Bad Request: message can't be edited")));

    await editMessageTextOrReply(ctx, "restored");

    expect(reply).toHaveBeenCalledWith("restored", undefined);
  });

  it("rethrows unrelated Telegram errors instead of masking them", async () => {
    const forbidden = grammyError("Forbidden: bot was blocked by the user", 403);
    const { ctx, reply } = fakeCtx(() => Promise.reject(forbidden));

    await expect(editMessageTextOrReply(ctx, "hello")).rejects.toBe(forbidden);
    expect(reply).not.toHaveBeenCalled();
  });
});

describe("editMessageReplyMarkupOrIgnore", () => {
  it("edits the keyboard in place on the happy path", async () => {
    const { ctx, editMessageReplyMarkup } = fakeCtx();
    const opts = { reply_markup: { inline_keyboard: [] } };

    await editMessageReplyMarkupOrIgnore(ctx, opts);

    expect(editMessageReplyMarkup).toHaveBeenCalledWith(opts);
  });

  it("silently ignores a too-old message (no text to re-send)", async () => {
    const { ctx, reply } = fakeCtx(() => Promise.reject(grammyError("Bad Request: message to edit not found")));

    await expect(
      editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } }),
    ).resolves.toBeUndefined();
    expect(reply).not.toHaveBeenCalled();
  });

  it("swallows 'message is not modified'", async () => {
    const { ctx } = fakeCtx(() => Promise.reject(grammyError("Bad Request: message is not modified")));

    await expect(editMessageReplyMarkupOrIgnore(ctx)).resolves.toBeUndefined();
  });

  it("rethrows unrelated Telegram errors", async () => {
    const forbidden = grammyError("Forbidden: bot was blocked by the user", 403);
    const { ctx } = fakeCtx(() => Promise.reject(forbidden));

    await expect(editMessageReplyMarkupOrIgnore(ctx)).rejects.toBe(forbidden);
  });
});
