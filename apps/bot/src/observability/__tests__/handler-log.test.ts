import type { Context } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlerChain, handlerName, markHandled, withHandlerLog } from "../handler-log.js";
import { collectEvents, type EventCollector, stopCollecting } from "./event-collector.js";

let events: EventCollector;

function ctxOf(): Context & { handledBy?: string[] } {
  return {} as Context & { handledBy?: string[] };
}

beforeEach(() => {
  events = collectEvents();
});

afterEach(() => {
  stopCollecting();
});

describe("withHandlerLog", () => {
  it("logs a start at debug and a finish at info with the handler name and duration", async () => {
    const ctx = ctxOf();
    const wrapped = withHandlerLog("handleDictView", async () => {});

    await wrapped(ctx, async () => {});

    expect(events.names()).toEqual(["handler.started", "handler.finished"]);
    expect(events.named("handler.started")[0]?.level).toBe("debug");
    expect(events.named("handler.finished")[0]?.fields).toMatchObject({ handler: "handleDictView" });
    expect(events.named("handler.finished")[0]?.fields.durationMs).toEqual(expect.any(Number));
  });

  it("records the handler on the context so the update summary can report it", async () => {
    const ctx = ctxOf();

    await withHandlerLog("handleDictView", async () => {})(ctx, async () => {});

    expect(handlerChain(ctx)).toEqual(["handleDictView"]);
  });

  it("appends to the chain when several wrapped handlers run for one update", async () => {
    const ctx = ctxOf();

    await withHandlerLog("mainKeyboard", async () => {})(ctx, async () => {});
    await withHandlerLog("handleDictionaryCommand", async () => {})(ctx, async () => {});

    expect(handlerChain(ctx)).toEqual(["mainKeyboard", "handleDictionaryCommand"]);
  });

  it("logs the failure and rethrows, leaving the global error handler in charge", async () => {
    const boom = new Error("db down");
    const wrapped = withHandlerLog("handleSaveCallback", async () => {
      throw boom;
    });

    await expect(wrapped(ctxOf(), async () => {})).rejects.toBe(boom);

    const failure = events.named("handler.failed")[0];
    expect(failure?.level).toBe("error");
    expect(failure?.fields).toMatchObject({ handler: "handleSaveCallback", error: "db down" });
    expect(events.named("handler.finished")).toHaveLength(0);
  });

  it("passes next through, so wrapping does not change routing", async () => {
    const next = vi.fn(async () => {});
    const wrapped = withHandlerLog("passthrough", async (_ctx, n) => {
      await n();
    });

    await wrapped(ctxOf(), next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves no finish record while the handler is still running, so a hang shows as a dangling start", async () => {
    let release: (() => void) | undefined;
    const wrapped = withHandlerLog("handleTranslateText", () => new Promise<void>((resolve) => (release = resolve)));

    const pending = wrapped(ctxOf(), async () => {});
    await Promise.resolve();
    expect(events.names()).toEqual(["handler.started"]);

    release?.();
    await pending;
    expect(events.names()).toEqual(["handler.started", "handler.finished"]);
  });
});

describe("markHandled", () => {
  it("starts a chain on a context that has none", () => {
    const ctx = ctxOf();
    markHandled(ctx, "modeRouter:translate");
    expect(handlerChain(ctx)).toEqual(["modeRouter:translate"]);
  });

  it("reports an empty chain for an untouched context", () => {
    expect(handlerChain(ctxOf())).toEqual([]);
  });
});

describe("handlerName", () => {
  it("uses the function's own name, so new routes are labelled without extra arguments", () => {
    async function handleDictView(): Promise<void> {}
    expect(handlerName(handleDictView, "callback:/^dict:view:/")).toBe("handleDictView");
  });

  it("falls back to the route pattern for an anonymous inline handler", () => {
    expect(handlerName({ name: "" }, "callback:noop")).toBe("callback:noop");
  });
});
