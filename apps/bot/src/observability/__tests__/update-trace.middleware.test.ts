import { getTraceContext } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BotContext } from "../../types.js";
import { markHandled } from "../handler-log.js";
import { updateTraceMiddleware } from "../update-trace.middleware.js";
import { collectEvents, type EventCollector, stopCollecting } from "./event-collector.js";

let events: EventCollector;

function ctxOf(parts: Partial<BotContext> = {}): BotContext {
  return {
    update: { update_id: 77, message: {} },
    from: { id: 555 },
    chat: { id: 555, type: "private" },
    message: { message_id: 1, text: "Haus" },
    ...parts,
  } as unknown as BotContext;
}

beforeEach(() => {
  events = collectEvents();
});

afterEach(() => {
  stopCollecting();
});

describe("updateTraceMiddleware", () => {
  it("brackets the update with received/finished records carrying duration", async () => {
    await updateTraceMiddleware(ctxOf(), async () => {});

    expect(events.names()).toEqual(["update.received", "update.finished", "update.unhandled"]);
    expect(events.named("update.received")[0]?.fields).toMatchObject({ updateType: "message", text: "Haus" });
    expect(events.named("update.finished")[0]?.fields.durationMs).toEqual(expect.any(Number));
  });

  it("opens a trace that downstream code inherits, identified by the Telegram update", async () => {
    let seen: ReturnType<typeof getTraceContext>;
    await updateTraceMiddleware(ctxOf(), async () => {
      // A nested await is the realistic case: handlers hit the DB and the AI.
      await Promise.resolve();
      seen = getTraceContext();
    });

    expect(seen).toMatchObject({
      source: "telegram.update",
      updateId: 77,
      telegramId: 555,
      chatId: 555,
    });
    expect(seen?.traceId).toEqual(expect.any(String));
  });

  it("closes the trace, so work after the update carries no stale identity", async () => {
    await updateTraceMiddleware(ctxOf(), async () => {});
    expect(getTraceContext()).toBeUndefined();
  });

  it("reports which handlers consumed the update", async () => {
    const ctx = ctxOf();
    await updateTraceMiddleware(ctx, async () => {
      markHandled(ctx, "handleDictView");
    });

    expect(events.named("update.finished")[0]?.fields.handledBy).toEqual(["handleDictView"]);
    expect(events.named("update.unhandled")).toHaveLength(0);
  });

  it("warns when no handler matched, which is what a dead button from an old keyboard looks like", async () => {
    const ctx = ctxOf({
      message: undefined,
      callbackQuery: { data: "legacy:gone:1" },
      update: { update_id: 78, callback_query: {} },
    } as unknown as Partial<BotContext>);

    await updateTraceMiddleware(ctx, async () => {});

    const unhandled = events.named("update.unhandled")[0];
    expect(unhandled?.level).toBe("warn");
    expect(unhandled?.fields).toMatchObject({ callbackData: "legacy:gone:1", callbackFamily: "legacy" });
    expect(events.named("update.finished")[0]?.fields.outcome).toBe("unhandled");
  });

  it("logs a failure with the handler chain and rethrows so bot.catch still runs", async () => {
    const boom = new Error("handler exploded");
    const ctx = ctxOf();

    await expect(
      updateTraceMiddleware(ctx, async () => {
        markHandled(ctx, "handleSaveCallback");
        throw boom;
      }),
    ).rejects.toBe(boom);

    const failure = events.named("update.failed")[0];
    expect(failure?.level).toBe("error");
    expect(failure?.fields).toMatchObject({ error: "handler exploded", handledBy: ["handleSaveCallback"] });
    expect(events.named("update.finished")).toHaveLength(0);
  });

  it("gives concurrently processed updates distinct trace ids", async () => {
    const seen: string[] = [];
    const capture = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const id = getTraceContext()?.traceId;
      if (id) seen.push(id);
    };

    await Promise.all([updateTraceMiddleware(ctxOf(), capture), updateTraceMiddleware(ctxOf(), capture)]);

    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
  });
});
