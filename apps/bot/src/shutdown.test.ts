/**
 * Tests for the graceful-shutdown orchestrator (B12): ordered cleanup,
 * idempotency, error isolation, and the hard force-exit deadline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isShuttingDown, resetLivenessState } from "./liveness-state.js";
import { createGracefulShutdown, type ShutdownLogger } from "./shutdown.js";

function stubLogger(): ShutdownLogger {
  return { info: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  resetLivenessState();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createGracefulShutdown", () => {
  it("runs every cleanup step in order", async () => {
    const order: string[] = [];
    const shutdown = createGracefulShutdown({
      steps: [
        { name: "a", run: () => void order.push("a") },
        { name: "b", run: async () => void order.push("b") },
        { name: "c", run: () => void order.push("c") },
      ],
      deadlineMs: 10_000,
      logger: stubLogger(),
      forceExit: vi.fn(),
    });

    await shutdown("SIGTERM");

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("is idempotent — a second signal does not re-run cleanup", async () => {
    const run = vi.fn();
    const shutdown = createGracefulShutdown({
      steps: [{ name: "once", run }],
      deadlineMs: 10_000,
      logger: stubLogger(),
      forceExit: vi.fn(),
    });

    await shutdown("SIGINT");
    await shutdown("SIGTERM");

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("isolates a failing step so later steps still run", async () => {
    const later = vi.fn();
    const logger = stubLogger();
    const shutdown = createGracefulShutdown({
      steps: [
        {
          name: "boom",
          run: () => {
            throw new Error("close failed");
          },
        },
        { name: "later", run: later },
      ],
      deadlineMs: 10_000,
      logger,
      forceExit: vi.fn(),
    });

    await shutdown("SIGTERM");

    expect(later).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalled();
  });

  it("force-exits when cleanup outruns the deadline", async () => {
    vi.useFakeTimers();
    const forceExit = vi.fn();
    const shutdown = createGracefulShutdown({
      steps: [
        {
          name: "hangs",
          run: () =>
            new Promise<void>(() => {
              /* never resolves */
            }),
        },
      ],
      deadlineMs: 5_000,
      logger: stubLogger(),
      forceExit,
    });

    void shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it("clears the deadline timer once cleanup completes in time", async () => {
    vi.useFakeTimers();
    const forceExit = vi.fn();
    const shutdown = createGracefulShutdown({
      steps: [{ name: "fast", run: () => undefined }],
      deadlineMs: 5_000,
      logger: stubLogger(),
      forceExit,
    });

    await shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(forceExit).not.toHaveBeenCalled();
  });

  it("marks liveness-state as shutting down before the runner-stop step runs (Phase 1a false-positive-restart guard)", async () => {
    // Regression test: /livez reads a stopping runner as a graceful shutdown only
    // because setShuttingDown(true) runs before any cleanup step — including the
    // step that stops the runner. If that ordering were ever dropped or reordered
    // after "runner", this assertion (evaluated AT THE MOMENT the runner step
    // executes) would fail, even though every other shutdown test stays green.
    expect(isShuttingDown()).toBe(false);

    const shutdown = createGracefulShutdown({
      steps: [
        {
          name: "runner",
          run: () => {
            expect(isShuttingDown()).toBe(true);
          },
        },
      ],
      deadlineMs: 10_000,
      logger: stubLogger(),
      forceExit: vi.fn(),
    });

    await shutdown("SIGTERM");

    expect(isShuttingDown()).toBe(true);
  });
});
