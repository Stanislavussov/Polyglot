/**
 * Behaviour of the technical-message ledger.
 *
 * Spec: a technical message (menu, prompt, hint, validation notice, transient
 * status, config confirmation) is recorded when sent and deleted on the next
 * sweep. Content messages — translation cards, mentor answers, notifications,
 * video results — never enter this ledger, so they can never be swept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext, SessionData } from "../types.js";
import {
  cleanupTechnicalMessages,
  MAX_TRACKED_TECHNICAL_MESSAGES,
  replyTechnical,
  trackTechnicalMessage,
} from "./message-cleanup.js";

function createCtx(overrides: Partial<{ session: SessionData | undefined; chatId: number | undefined }> = {}) {
  const session =
    "session" in overrides ? overrides.session : ({ activeMode: "translate", translationMap: {} } as SessionData);
  return {
    chat: "chatId" in overrides ? (overrides.chatId === undefined ? undefined : { id: overrides.chatId }) : { id: 555 },
    session,
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
    api: { deleteMessage: vi.fn().mockResolvedValue(true) },
  } as unknown as BotContext;
}

describe("trackTechnicalMessage", () => {
  it("records the id so the next sweep can delete it", () => {
    const ctx = createCtx();

    trackTechnicalMessage(ctx, 10);
    trackTechnicalMessage(ctx, 11);

    expect(ctx.session.technicalMessages).toEqual([10, 11]);
  });

  it("ignores a repeated id so one message is never queued for deletion twice", () => {
    const ctx = createCtx();

    trackTechnicalMessage(ctx, 10);
    trackTechnicalMessage(ctx, 10);

    expect(ctx.session.technicalMessages).toEqual([10]);
  });

  it("keeps only the newest ids so a long-lived session cannot grow without bound", () => {
    const ctx = createCtx();
    const overflow = MAX_TRACKED_TECHNICAL_MESSAGES + 5;

    for (let id = 1; id <= overflow; id++) trackTechnicalMessage(ctx, id);

    const ids = ctx.session.technicalMessages ?? [];
    expect(ids).toHaveLength(MAX_TRACKED_TECHNICAL_MESSAGES);
    expect(ids[0]).toBe(6);
    expect(ids.at(-1)).toBe(overflow);
  });

  it("is a no-op without a session — the bot.catch notice can fire before session middleware", () => {
    const ctx = createCtx({ session: undefined });

    expect(() => trackTechnicalMessage(ctx, 10)).not.toThrow();
  });
});

describe("cleanupTechnicalMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes every tracked message and empties the ledger", async () => {
    const ctx = createCtx();
    trackTechnicalMessage(ctx, 10);
    trackTechnicalMessage(ctx, 11);

    await cleanupTechnicalMessages(ctx);

    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(555, 10);
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(555, 11);
    expect(ctx.session.technicalMessages).toEqual([]);
  });

  it("clears the ledger even when Telegram refuses — a message older than 48h can never be deleted", async () => {
    const ctx = createCtx();
    vi.mocked(ctx.api.deleteMessage).mockRejectedValue(new Error("message can't be deleted"));
    trackTechnicalMessage(ctx, 10);

    await expect(cleanupTechnicalMessages(ctx)).resolves.toBeUndefined();

    expect(ctx.session.technicalMessages).toEqual([]);
  });

  it("makes no API call when nothing is tracked", async () => {
    const ctx = createCtx();

    await cleanupTechnicalMessages(ctx);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
  });

  it("drops the ledger without deleting when the chat is unknown", async () => {
    const ctx = createCtx({ chatId: undefined });
    trackTechnicalMessage(ctx, 10);

    await cleanupTechnicalMessages(ctx);

    expect(ctx.api.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.session.technicalMessages).toEqual([]);
  });
});

describe("replyTechnical", () => {
  it("sends the message and tracks it in one step", async () => {
    const ctx = createCtx();

    const msg = await replyTechnical(ctx, "Choose a language", { parse_mode: "HTML" });

    expect(ctx.reply).toHaveBeenCalledWith("Choose a language", { parse_mode: "HTML" });
    expect(msg.message_id).toBe(42);
    expect(ctx.session.technicalMessages).toEqual([42]);
  });

  it("leaves a plain ctx.reply untracked — that is how content messages stay on screen", async () => {
    const ctx = createCtx();

    await ctx.reply("<b>Translation card</b>");

    expect(ctx.session.technicalMessages).toBeUndefined();
  });
});
