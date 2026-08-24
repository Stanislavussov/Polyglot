import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleMentorText } = vi.hoisted(() => ({
  mockHandleMentorText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./mentor-mode.helper.js", () => ({
  handleMentorText: mockHandleMentorText,
}));

import type { BotContext } from "../../types.js";
import { tryHandleMentorReply } from "./mentor-thread.helper.js";

const BOT_ID = 42;
const THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createMockCtx(replyTo: unknown, findThreadByMessage = vi.fn().mockResolvedValue(null)): BotContext {
  return {
    me: { id: BOT_ID },
    chat: { id: 123 },
    message: { message_id: 7, text: "and in questions?", reply_to_message: replyTo },
    session: { activeMode: "translate" },
    services: { mentorMessageRepository: { findThreadByMessage } },
  } as unknown as BotContext;
}

describe("tryHandleMentorReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores a reply to a non-bot message without touching the DB", async () => {
    const lookup = vi.fn();
    const ctx = createMockCtx({ message_id: 5, from: { id: 999, is_bot: false } }, lookup);
    expect(await tryHandleMentorReply(ctx, "text")).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("ignores a reply to another bot's message", async () => {
    const ctx = createMockCtx({ message_id: 5, from: { id: 777, is_bot: true } });
    expect(await tryHandleMentorReply(ctx, "text")).toBe(false);
  });

  it("falls through when the replied-to message anchors no mentor thread", async () => {
    const lookup = vi.fn().mockResolvedValue(null);
    const ctx = createMockCtx({ message_id: 5, from: { id: BOT_ID, is_bot: true } }, lookup);
    expect(await tryHandleMentorReply(ctx, "text")).toBe(false);
    expect(lookup).toHaveBeenCalledWith(123, 5);
    expect(mockHandleMentorText).not.toHaveBeenCalled();
  });

  it("degrades to normal routing when the thread lookup throws", async () => {
    const lookup = vi.fn().mockRejectedValue(new Error("db down"));
    const ctx = createMockCtx({ message_id: 5, from: { id: BOT_ID, is_bot: true } }, lookup);
    expect(await tryHandleMentorReply(ctx, "text")).toBe(false);
    expect(mockHandleMentorText).not.toHaveBeenCalled();
  });

  it("runs the mentor turn in the anchored thread on a hit", async () => {
    const lookup = vi.fn().mockResolvedValue(THREAD);
    const ctx = createMockCtx({ message_id: 5, from: { id: BOT_ID, is_bot: true } }, lookup);
    expect(await tryHandleMentorReply(ctx, "and in questions?")).toBe(true);
    expect(mockHandleMentorText).toHaveBeenCalledWith(ctx, "and in questions?", { threadId: THREAD });
  });
});
