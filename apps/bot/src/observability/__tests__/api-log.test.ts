import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiLogTransformer } from "../api-log.js";
import { collectEvents, type EventCollector, stopCollecting } from "./event-collector.js";

let events: EventCollector;

/** Stands in for the next link of grammY's transformer chain. */
type Prev = Parameters<ReturnType<typeof createApiLogTransformer>>[0];

function prevReturning(result: unknown): Prev {
  return (async () => result) as unknown as Prev;
}

function callTransformer(prev: Prev, method: string, payload: Record<string, unknown>): Promise<unknown> {
  const transformer = createApiLogTransformer();
  return transformer(prev, method as never, payload as never, undefined);
}

beforeEach(() => {
  events = collectEvents();
});

afterEach(() => {
  stopCollecting();
});

describe("api log transformer", () => {
  it("logs a successful call with its method, target and duration", async () => {
    await callTransformer(prevReturning({ ok: true, result: {} }), "sendMessage", {
      chat_id: 42,
      text: "Hallo",
    });

    const call = events.named("telegram.api.call")[0];
    expect(call?.level).toBe("info");
    expect(call?.fields).toMatchObject({ method: "sendMessage", chatId: 42, ok: true, outgoingLength: 5 });
    expect(call?.fields.durationMs).toEqual(expect.any(Number));
  });

  it("logs the rendered body only at debug, so info stays readable but a bad card is reproducible", async () => {
    await callTransformer(prevReturning({ ok: true, result: {} }), "sendMessage", {
      chat_id: 42,
      text: "🇩🇪 das Haus — the house",
    });

    const body = events.named("telegram.api.body")[0];
    expect(body?.level).toBe("debug");
    expect(body?.fields.body).toBe("🇩🇪 das Haus — the house");
  });

  it("surfaces a Telegram rejection that the chain returns rather than throws", async () => {
    // The 48h edit limit arrives this way: a well-formed response saying no.
    await callTransformer(
      prevReturning({ ok: false, error_code: 400, description: "Bad Request: message to edit not found" }),
      "editMessageText",
      { chat_id: 42, message_id: 9 },
    );

    expect(events.named("telegram.api.call")[0]?.fields).toMatchObject({
      method: "editMessageText",
      messageId: 9,
      ok: false,
      errorCode: 400,
      error: "Bad Request: message to edit not found",
    });
  });

  it("logs a transport failure and rethrows it untouched", async () => {
    const boom = new Error("socket hang up");
    const prev = (() => Promise.reject(boom)) as unknown as Prev;

    await expect(callTransformer(prev, "sendMessage", { chat_id: 42 })).rejects.toBe(boom);

    const failure = events.named("telegram.api.failed")[0];
    expect(failure?.level).toBe("error");
    expect(failure?.fields).toMatchObject({ method: "sendMessage", error: "socket hang up" });
  });

  it("handles a payload with no chat or text, such as an answerCallbackQuery ack", async () => {
    await callTransformer(prevReturning({ ok: true, result: true }), "answerCallbackQuery", {
      callback_query_id: "abc",
    });

    expect(events.named("telegram.api.call")[0]?.fields).toMatchObject({ method: "answerCallbackQuery", ok: true });
    expect(events.named("telegram.api.body")).toHaveLength(0);
  });
});
