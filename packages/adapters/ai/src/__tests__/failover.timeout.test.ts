/**
 * Failover budget-split integration at the generate() boundary.
 *
 * These exercise the REAL generate → runGenerate → withModelFailover → timeout
 * pipeline (only the `ai` SDK is mocked), proving the fixed split holds at runtime
 * — not just in arithmetic. The headline test is load-bearing: it fails on a naive
 * impl that gives each attempt its own full budget.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogRequest = vi.fn();
vi.mock("../logger.js", () => ({
  logRequest: (...args: unknown[]) => mockLogRequest(...args),
}));

vi.mock("../client.js", () => ({
  getModel: (id: string) => ({ modelId: id }),
}));

const mockAiGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: (...args: unknown[]) => mockAiGenerateText(...args),
}));

import { generateText } from "../generate.js";
import { setAIRequestTimeoutProvider } from "../timeout.js";

/** Default admin budget B; the split reserves 5s so the primary window is 10s. */
const B = 15_000;
const FAILOVER = { fallbackModel: "fallback/model", primaryBudgetMs: 10_000, reservedFallbackMs: 5_000 };

/** A provider that never resolves on its own — only rejects when its signal aborts. */
function hangUntilAbort(opts: { abortSignal?: AbortSignal }): Promise<never> {
  return new Promise((_, reject) => {
    opts.abortSignal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
  });
}

describe("failover budget split (generate boundary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    setAIRequestTimeoutProvider(null);
  });

  it("HEADLINE: a hung primary is aborted at primaryBudgetMs and BOTH attempts fit inside B", async () => {
    vi.useFakeTimers();
    setAIRequestTimeoutProvider(() => B);

    // Primary hangs forever → must be aborted by its own (10s) budget.
    mockAiGenerateText.mockImplementationOnce(hangUntilAbort);
    // Fallback does 3s of work — well within its 5s reserved window.
    mockAiGenerateText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ text: "fallback reply", usage: { inputTokens: 1, outputTokens: 1 } }), 3_000);
        }),
    );

    const start = Date.now();
    const pending = generateText("hi", "primary/model", { failover: FAILOVER });
    await vi.runAllTimersAsync();
    const result = await pending;
    const elapsed = Date.now() - start;

    expect(result).toBe("fallback reply");
    // Correct split: 10_000 (primary abort) + 3_000 (fallback) = 13_000 <= B (15_000).
    // A double-full-budget impl (primary bounded by B=15_000) lands at 18_000 > B → RED.
    expect(elapsed).toBeLessThanOrEqual(B);
  });

  it("bounds the primary at the INJECTED primaryBudgetMs, not the resolved B", async () => {
    vi.useFakeTimers();
    setAIRequestTimeoutProvider(() => B);

    mockAiGenerateText.mockImplementationOnce(hangUntilAbort);
    mockAiGenerateText.mockResolvedValueOnce({ text: "fb", usage: { inputTokens: 1, outputTokens: 1 } });

    const pending = generateText("hi", "primary/model", { failover: FAILOVER });

    // Just before the 10s primary budget: still on the primary, no fallback yet.
    await vi.advanceTimersByTimeAsync(9_999);
    expect(mockAiGenerateText).toHaveBeenCalledTimes(1);

    // Crossing 10s aborts the primary and invokes the fallback — proving the bound
    // is primaryBudgetMs (10s), not B (15s). If B were used, no fallback here.
    await vi.advanceTimersByTimeAsync(2);
    await pending;
    expect(mockAiGenerateText).toHaveBeenCalledTimes(2);
    expect(mockAiGenerateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: { modelId: "fallback/model" } }),
    );
  });

  it("passes each attempt its own fresh abort signal and the right model", async () => {
    mockAiGenerateText.mockRejectedValueOnce({ statusCode: 429 });
    mockAiGenerateText.mockResolvedValueOnce({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } });

    const result = await generateText("hi", "primary/model", { failover: FAILOVER });

    expect(result).toBe("ok");
    expect(mockAiGenerateText).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: { modelId: "primary/model" }, abortSignal: expect.any(AbortSignal) }),
    );
    expect(mockAiGenerateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: { modelId: "fallback/model" }, abortSignal: expect.any(AbortSignal) }),
    );
  });

  it("without failover, behavior is unchanged (single attempt, no split)", async () => {
    mockAiGenerateText.mockResolvedValueOnce({ text: "plain", usage: { inputTokens: 1, outputTokens: 1 } });

    const result = await generateText("hi", "primary/model");

    expect(result).toBe("plain");
    expect(mockAiGenerateText).toHaveBeenCalledTimes(1);
  });

  it("REGRESSION: an injected NON-FINITE budget falls back to the resolved default, not an instant abort", async () => {
    // Simulates the "timed out after NaNms" outage at the generate boundary,
    // BYPASSING buildAiFailover — so it proves generate.ts's own guard, independent
    // of the failover-source fix. With the bug, budgetMs=NaN → setTimeout(NaN) aborts
    // the primary at ~0ms; with the fix, NaN → resolveRequestTimeoutMs()=B, so a
    // primary that resolves in 3s completes normally with no fallback.
    vi.useFakeTimers();
    setAIRequestTimeoutProvider(() => B);

    mockAiGenerateText.mockImplementationOnce(
      (opts: { abortSignal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          opts.abortSignal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
          setTimeout(() => resolve({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } }), 3_000);
        }),
    );

    const NAN_FAILOVER = {
      fallbackModel: "fallback/model",
      primaryBudgetMs: Number.NaN,
      reservedFallbackMs: Number.NaN,
    };
    const pending = generateText("hi", "primary/model", { failover: NAN_FAILOVER });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe("ok");
    // Primary succeeded on the coerced 15s budget → no fallback attempt.
    expect(mockAiGenerateText).toHaveBeenCalledTimes(1);
  });
});
