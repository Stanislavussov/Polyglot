/**
 * Tests for long-operation helpers: bounded waits with a user-visible
 * timeout and the fire-and-forget typing indicator.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import { OperationTimeoutError, sendTypingIndicator, withTimeout } from "./long-op.js";

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

describe("sendTypingIndicator", () => {
  it("never fails the flow when Telegram rejects the chat action", async () => {
    const ctx = {
      replyWithChatAction: vi.fn().mockRejectedValue(new Error("network")),
    } as unknown as BotContext;

    expect(() => sendTypingIndicator(ctx)).not.toThrow();
    await vi.waitFor(() => expect(ctx.replyWithChatAction).toHaveBeenCalledWith("typing"));
  });
});
