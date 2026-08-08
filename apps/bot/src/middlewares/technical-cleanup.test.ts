/**
 * Behaviour of the central technical-message sweep.
 *
 * Spec: every new user-initiated message (typed text, command, menu tap,
 * non-text upload) clears the technical messages left over from the previous
 * interaction, before any handler runs. Callback queries are deliberately
 * excluded: a tap usually acts on a tracked menu, and sweeping it would delete
 * the very keyboard the user is using.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext, SessionData } from "../types.js";
import { technicalCleanupMiddleware } from "./technical-cleanup.js";

interface CtxOptions {
  tracked?: number[];
  kind?: "message" | "callback";
}

function createCtx(options: CtxOptions = {}): BotContext {
  const session = {
    activeMode: "translate",
    technicalMessages: options.tracked,
  } as SessionData;

  const isCallback = options.kind === "callback";
  return {
    chat: { id: 555 },
    message: isCallback ? undefined : { text: "hello", message_id: 7 },
    callbackQuery: isCallback ? { data: "set:back" } : undefined,
    session,
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
  } as unknown as BotContext;
}

describe("technicalCleanupMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes leftover technical messages when the user sends a new message", async () => {
    const ctx = createCtx({ tracked: [10, 11] });
    const next = vi.fn();

    await technicalCleanupMiddleware(ctx, next);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(555, 10);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(555, 11);
    expect(ctx.session.technicalMessages).toEqual([]);
    expect(next).toHaveBeenCalled();
  });

  it("sweeps before the handler runs, so a notice sent for this update survives", async () => {
    const ctx = createCtx({ tracked: [10] });
    const order: string[] = [];
    vi.mocked(ctx.api.deleteMessage).mockImplementation(async () => {
      order.push("delete");
      return true;
    });

    await technicalCleanupMiddleware(ctx, async () => {
      order.push("handler");
    });

    expect(order).toEqual(["delete", "handler"]);
  });

  it("leaves the menu alone on a button tap — the tap is acting on a tracked message", async () => {
    const ctx = createCtx({ tracked: [10], kind: "callback" });
    const next = vi.fn();

    await technicalCleanupMiddleware(ctx, next);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.session.technicalMessages).toEqual([10]);
    expect(next).toHaveBeenCalled();
  });

  it("passes the update on when there is nothing to sweep", async () => {
    const ctx = createCtx();
    const next = vi.fn();

    await technicalCleanupMiddleware(ctx, next);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("still runs the handler when Telegram refuses to delete", async () => {
    const ctx = createCtx({ tracked: [10] });
    vi.mocked(ctx.api.deleteMessage).mockRejectedValue(new Error("message to delete not found"));
    const next = vi.fn();

    await technicalCleanupMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
  });
});
