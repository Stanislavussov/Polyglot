import { AICircuitOpenError, t } from "@polyglot/core";
import { type BotError, GrammyError } from "grammy";
import { describe, expect, it, vi } from "vitest";
import { handleBotError } from "./bot-error-handler.js";
import type { BotContext } from "./types.js";

interface FakeCtxOptions {
  sessionThrows?: boolean;
  withCallback?: boolean;
  replyRejects?: boolean;
}

function fakeError(cause: unknown, opts: FakeCtxOptions = {}): BotError<BotContext> {
  const reply = vi.fn(opts.replyRejects ? () => Promise.reject(new Error("reply failed")) : () => Promise.resolve());
  const answerCallbackQuery = vi.fn(() => Promise.resolve());

  const ctx = {
    from: { id: 42, language_code: "en" },
    message: { text: "/translate hello" },
    callbackQuery: opts.withCallback ? { data: "tr:oos:cs" } : undefined,
    reply,
    answerCallbackQuery,
  } as unknown as BotContext & { reply: typeof reply; answerCallbackQuery: typeof answerCallbackQuery };

  if (opts.sessionThrows) {
    Object.defineProperty(ctx, "session", {
      get() {
        throw new Error("session data unavailable (middleware did not run)");
      },
    });
  } else {
    (ctx as unknown as { session: { activeMode: string } }).session = { activeMode: "translate" };
  }

  return { ctx, error: cause } as unknown as BotError<BotContext>;
}

describe("handleBotError (T15)", () => {
  it("does not throw when the error happened before the session middleware ran", async () => {
    const err = fakeError(new Error("boom"), { sessionThrows: true });

    await expect(handleBotError(err)).resolves.toBeUndefined();
    // A best-effort reply is still attempted despite the unreadable session.
    expect((err.ctx as unknown as { reply: ReturnType<typeof vi.fn> }).reply).toHaveBeenCalledOnce();
  });

  it("replies to the user and clears the button spinner on an application error", async () => {
    const err = fakeError(new Error("handler blew up"), { withCallback: true });

    await handleBotError(err);

    const ctx = err.ctx as unknown as {
      reply: ReturnType<typeof vi.fn>;
      answerCallbackQuery: ReturnType<typeof vi.fn>;
    };
    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
  });

  it("surfaces an open circuit (Phase 3) as the graceful 'try again shortly' notice, never a hard error", async () => {
    const err = fakeError(new AICircuitOpenError("google/gemini-3.1-flash"));

    await handleBotError(err);

    const ctx = err.ctx as unknown as { reply: ReturnType<typeof vi.fn> };
    expect(ctx.reply).toHaveBeenCalledOnce();
    // The softer timeout-style message, not the hard genericError.
    expect(ctx.reply).toHaveBeenCalledWith(t("loadingTimeout", "en"));
    expect(ctx.reply).not.toHaveBeenCalledWith(t("genericError", "en"));
  });

  it("does not reply on a Telegram API error (the reply would just fail again)", async () => {
    const grammyError = Object.create(GrammyError.prototype) as GrammyError & { error_code: number };
    Object.assign(grammyError, { message: "Forbidden", error_code: 403 });
    const err = fakeError(grammyError);

    await handleBotError(err);

    expect((err.ctx as unknown as { reply: ReturnType<typeof vi.fn> }).reply).not.toHaveBeenCalled();
  });

  it("never throws even if the best-effort reply itself fails", async () => {
    const err = fakeError(new Error("boom"), { replyRejects: true });

    await expect(handleBotError(err)).resolves.toBeUndefined();
  });
});
