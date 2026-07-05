/**
 * Tests for long-operation helpers: bounded waits with a user-visible
 * timeout and the fire-and-forget typing indicator.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../types.js";
import {
  AI_BUDGET_SAFETY_MARGIN_MS,
  clampAiBudgetToOpGuard,
  LONG_OP_TIMEOUT_MS,
  OperationTimeoutError,
  sendTypingIndicator,
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
