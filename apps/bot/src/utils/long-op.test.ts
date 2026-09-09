/**
 * Tests for long-operation helpers: bounded waits with a user-visible
 * timeout, the fire-and-forget typing indicator, and the rotating loader.
 */
import { allLoaderPhraseKeys, loaderPhraseKeys, t } from "@polyglot/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import {
  AI_BUDGET_SAFETY_MARGIN_MS,
  clampAiBudgetToOpGuard,
  dismissLoader,
  LONG_OP_TIMEOUT_MS,
  OperationTimeoutError,
  sendLoader,
  sendTypingIndicator,
  startTypingKeepalive,
  withTimeout,
} from "./long-op.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("returns the result when the work finishes in time", async () => {
    await expect(withTimeout(Promise.resolve("card"), 1000)).resolves.toBe("card");
  });

  it("rejects with OperationTimeoutError when the work exceeds the limit", async () => {
    vi.useFakeTimers();
    const never = new Promise(() => {
      /* pending forever */
    });

    const result = withTimeout(never, 20_000);
    const assertion = expect(result).rejects.toBeInstanceOf(OperationTimeoutError);
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
  });

  it("propagates the work's own failure unchanged", async () => {
    await expect(withTimeout(Promise.reject(new Error("db down")), 1000)).rejects.toThrow("db down");
  });
});

describe("clampAiBudgetToOpGuard (B8: two-layer timeout invariant)", () => {
  it("keeps a budget already below the outer guard unchanged", () => {
    expect(clampAiBudgetToOpGuard(15_000)).toBe(15_000);
  });

  it("clamps a budget that meets or exceeds the outer guard below it", () => {
    const clamped = clampAiBudgetToOpGuard(30_000);
    expect(clamped).toBe(LONG_OP_TIMEOUT_MS - AI_BUDGET_SAFETY_MARGIN_MS);
    expect(clamped).toBeLessThan(LONG_OP_TIMEOUT_MS);
  });

  it("guarantees the AI budget is always strictly below the outer op guard", () => {
    // Spans the adapter default (15_000) and values at/above the outer guard.
    for (const budget of [1_000, 15_000, 20_000, 25_000, 60_000]) {
      expect(clampAiBudgetToOpGuard(budget)).toBeLessThan(LONG_OP_TIMEOUT_MS);
    }
  });
});

describe("sendTypingIndicator", () => {
  it("never fails the flow when Telegram rejects the chat action", async () => {
    const ctx = {
      replyWithChatAction: vi.fn().mockRejectedValue(new Error("network")),
    } as unknown as BotContext;

    expect(() => sendTypingIndicator(ctx)).not.toThrow();
    await vi.waitFor(() => expect(ctx.replyWithChatAction).toHaveBeenCalledWith("typing"));
  });
});

describe("startTypingKeepalive", () => {
  it("sends typing immediately and refreshes it on an interval until stopped", () => {
    vi.useFakeTimers();
    const ctx = {
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
    } as unknown as BotContext;

    const stop = startTypingKeepalive(ctx);
    // Immediate action so the user sees "typing…" without waiting a full tick.
    expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(1);

    // Telegram clears the action after ~5s; the keep-alive refreshes below that.
    vi.advanceTimersByTime(12_000);
    expect((ctx.replyWithChatAction as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);

    const callsAtStop = (ctx.replyWithChatAction as ReturnType<typeof vi.fn>).mock.calls.length;
    stop();
    vi.advanceTimersByTime(20_000);
    // No further actions once stopped — the interval is cleared.
    expect(ctx.replyWithChatAction).toHaveBeenCalledTimes(callsAtStop);
  });
});

/** A ctx stub that records the loader message and every edit made to it. */
function loaderCtx() {
  const editMessageText = vi.fn().mockResolvedValue(undefined);
  const deleteMessage = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue({ message_id: 42, chat: { id: 7 } });
  const ctx = {
    reply,
    chat: { id: 7 },
    api: { editMessageText, deleteMessage },
  } as unknown as BotContext;
  return { ctx, reply, editMessageText, deleteMessage };
}

/** The text of every loader state the user saw, in order. */
function shownTexts(reply: ReturnType<typeof vi.fn>, edit: ReturnType<typeof vi.fn>): string[] {
  return [reply.mock.calls[0]?.[0] as string, ...edit.mock.calls.map((call) => call[2] as string)];
}

describe("sendLoader", () => {
  it("opens on a first-stage phrase", async () => {
    const { ctx, reply } = loaderCtx();
    const opening = loaderPhraseKeys("translate", 0).map((key) => t(key, "en"));

    await sendLoader(ctx, "translate", "en");

    expect(opening).toContain(reply.mock.calls[0]?.[0]);
  });

  it("walks the wait forward through later stages without ever repeating itself", async () => {
    vi.useFakeTimers();
    const { ctx, reply, editMessageText } = loaderCtx();

    const loader = await sendLoader(ctx, "mentor", "ru");
    await vi.advanceTimersByTimeAsync(11_000);
    loader.stop();

    const texts = shownTexts(reply, editMessageText);
    expect(texts).toHaveLength(3);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[1]).toBeOneOf(loaderPhraseKeys("mentor", 1).map((key) => t(key, "ru")));
    expect(texts[2]).toBeOneOf(loaderPhraseKeys("mentor", 2).map((key) => t(key, "ru")));
    // Every edit targets the one loader message, in the chat it was sent to.
    for (const call of editMessageText.mock.calls) {
      expect(call.slice(0, 2)).toEqual([7, 42]);
    }
  });

  it("keeps drawing fresh last-stage phrases while a wait runs to the guard", async () => {
    vi.useFakeTimers();
    const { ctx, reply, editMessageText } = loaderCtx();
    const mentorPhrases = allLoaderPhraseKeys("mentor").map((key) => t(key, "en"));

    const loader = await sendLoader(ctx, "mentor", "en");
    await vi.advanceTimersByTimeAsync(LONG_OP_TIMEOUT_MS);
    loader.stop();

    const texts = shownTexts(reply, editMessageText);
    expect(texts.length).toBeGreaterThan(3);
    expect(texts.every((text) => mentorPhrases.includes(text))).toBe(true);
    // Consecutive repeats are what Telegram rejects as "message is not modified".
    expect(texts.some((text, i) => i > 0 && text === texts[i - 1])).toBe(false);
  });

  it("stops rotating once stopped", async () => {
    vi.useFakeTimers();
    const { ctx, editMessageText } = loaderCtx();

    const loader = await sendLoader(ctx, "translate", "en");
    loader.stop();
    await vi.advanceTimersByTimeAsync(LONG_OP_TIMEOUT_MS);

    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("survives a rejected edit — a cosmetic tick must never break the flow", async () => {
    vi.useFakeTimers();
    const { ctx, editMessageText } = loaderCtx();
    editMessageText.mockRejectedValue(new Error("message to edit not found"));

    const loader = await sendLoader(ctx, "translate", "en");
    await vi.advanceTimersByTimeAsync(11_000);
    loader.stop();

    // Both ticks fired and neither rejection escaped as an unhandled failure.
    expect(editMessageText).toHaveBeenCalledTimes(2);
  });
});

describe("dismissLoader", () => {
  it("silences the ticker before removing the message it edits", async () => {
    vi.useFakeTimers();
    const { ctx, editMessageText, deleteMessage } = loaderCtx();

    const loader = await sendLoader(ctx, "translate", "en");
    await dismissLoader(ctx, loader);
    await vi.advanceTimersByTimeAsync(LONG_OP_TIMEOUT_MS);

    expect(deleteMessage).toHaveBeenCalledWith(7, 42);
    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("ignores a message Telegram has already dropped", async () => {
    const { ctx, deleteMessage } = loaderCtx();
    deleteMessage.mockRejectedValue(new Error("message to delete not found"));

    const loader = await sendLoader(ctx, "translate", "en");

    await expect(dismissLoader(ctx, loader)).resolves.toBeUndefined();
  });
});
