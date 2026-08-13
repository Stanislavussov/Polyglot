import { describe, expect, it } from "vitest";
import { enrichTrace, getTraceContext, newTraceId, runWithTrace, traceLogFields } from "../trace-context.js";

describe("trace context", () => {
  it("exposes the trace to code running underneath it, and nothing outside", async () => {
    expect(getTraceContext()).toBeUndefined();

    const seen = await runWithTrace({ traceId: "abc", source: "telegram.update" }, async () => {
      // A nested async boundary is the realistic case: handlers await DB and AI.
      await Promise.resolve();
      return getTraceContext()?.traceId;
    });

    expect(seen).toBe("abc");
    expect(getTraceContext()).toBeUndefined();
  });

  it("keeps concurrent traces isolated, as the grammY runner processes updates in parallel", async () => {
    const observed: Array<string | undefined> = [];

    const one = runWithTrace({ traceId: "one", source: "telegram.update" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      observed.push(getTraceContext()?.traceId);
    });
    const two = runWithTrace({ traceId: "two", source: "telegram.update" }, async () => {
      observed.push(getTraceContext()?.traceId);
    });

    await Promise.all([one, two]);

    expect(observed).toEqual(["two", "one"]);
  });

  it("propagates a late-resolved userId to log lines emitted before auth ran", async () => {
    // The auth middleware only learns userId after a DB lookup, but the update
    // was already logged; enrichment must reach the shared store, not a copy.
    const before: Array<number | undefined> = [];

    await runWithTrace({ traceId: "abc", source: "telegram.update", telegramId: 111 }, async () => {
      before.push(getTraceContext()?.userId);
      enrichTrace({ userId: 42 });
      before.push(getTraceContext()?.userId);
    });

    expect(before).toEqual([undefined, 42]);
  });

  it("ignores undefined enrichment so a missing chat id cannot erase a known one", async () => {
    await runWithTrace({ traceId: "abc", source: "telegram.update", chatId: 5 }, async () => {
      enrichTrace({ chatId: undefined, userId: 42 });
      expect(getTraceContext()?.chatId).toBe(5);
      expect(getTraceContext()?.userId).toBe(42);
    });
  });

  it("is a no-op outside a trace, so background code needs no guard", () => {
    expect(() => enrichTrace({ userId: 1 })).not.toThrow();
  });

  it("mints distinct trace ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newTraceId));
    expect(ids.size).toBe(200);
  });
});

describe("traceLogFields (what the logger stamps on every record)", () => {
  it("returns nothing outside a trace, keeping startup and CLI logs clean", () => {
    expect(traceLogFields()).toEqual({});
  });

  it("emits only the identity fields that are actually known", async () => {
    await runWithTrace({ traceId: "abc", source: "telegram.update", telegramId: 111, chatId: 222 }, async () => {
      expect(traceLogFields()).toEqual({
        traceId: "abc",
        source: "telegram.update",
        telegramId: 111,
        chatId: 222,
      });
    });
  });

  it("picks up enrichment, so post-auth records carry the resolved userId", async () => {
    await runWithTrace({ traceId: "abc", source: "cron.notifications", jobName: "notifications" }, async () => {
      enrichTrace({ userId: 42 });
      expect(traceLogFields()).toMatchObject({ jobName: "notifications", userId: 42 });
    });
  });
});
