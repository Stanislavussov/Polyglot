import { describe, expect, it, vi } from "vitest";
import type { BotContext, SessionData } from "../types.js";
import { parseTranslateInput } from "./parse-translate-input.js";
import {
  encodeTranslateRetryText,
  MAX_RETRY_ACTIONS,
  RETRY_CALLBACK,
  replyWithRetry,
  setRetryAction,
  takeRetryAction,
} from "./retry-action.js";

function makeSession(): SessionData {
  return { activeMode: "translate" } as SessionData;
}

describe("retry action store", () => {
  it("returns the action stored for a notice message", () => {
    const session = makeSession();
    setRetryAction(session, 42, { kind: "translate", text: "Haus" });

    expect(takeRetryAction(session, 42)).toMatchObject({ kind: "translate", text: "Haus" });
  });

  it("keeps two concurrent notices from cross-wiring their inputs", () => {
    const session = makeSession();
    setRetryAction(session, 10, { kind: "translate", text: "first" });
    setRetryAction(session, 11, { kind: "mentor", text: "second" });

    expect(takeRetryAction(session, 10)).toMatchObject({ kind: "translate", text: "first" });
    expect(takeRetryAction(session, 11)).toMatchObject({ kind: "mentor", text: "second" });
  });

  it("consumes the action so a second tap cannot launch the same paid call twice", () => {
    const session = makeSession();
    setRetryAction(session, 7, { kind: "mentor", text: "hello" });

    expect(takeRetryAction(session, 7)).toBeDefined();
    expect(takeRetryAction(session, 7)).toBeUndefined();
  });

  it("returns undefined for a notice that was never stored", () => {
    expect(takeRetryAction(makeSession(), 99)).toBeUndefined();
  });

  it("evicts the oldest entries past the cap, keeping the newest usable", () => {
    const session = makeSession();
    for (let i = 0; i < MAX_RETRY_ACTIONS + 3; i++) {
      setRetryAction(session, 100 + i, { kind: "translate", text: `word-${i}` });
    }

    expect(Object.keys(session.pendingRetries ?? {})).toHaveLength(MAX_RETRY_ACTIONS);
    // Oldest three are gone; the most recent survives.
    expect(takeRetryAction(session, 100)).toBeUndefined();
    expect(takeRetryAction(session, 100 + MAX_RETRY_ACTIONS + 2)).toMatchObject({
      text: `word-${MAX_RETRY_ACTIONS + 2}`,
    });
  });

  it("never evicts the entry just added when message ids restart low", () => {
    // A recreated chat (or another bot sharing the session key) restarts ids at
    // 1 while stale high-id entries are still in the map.
    const session = makeSession();
    for (let i = 0; i < MAX_RETRY_ACTIONS; i++) {
      setRetryAction(session, 9000 + i, { kind: "translate", text: `stale-${i}` });
    }
    setRetryAction(session, 1, { kind: "translate", text: "fresh" });

    expect(takeRetryAction(session, 1)).toMatchObject({ text: "fresh" });
  });
});

describe("encodeTranslateRetryText", () => {
  it("round-trips a word without context unchanged", () => {
    expect(parseTranslateInput(encodeTranslateRetryText("Haus"))).toEqual({ text: "Haus" });
  });

  it("round-trips a word plus context hint through the text parser", () => {
    const encoded = encodeTranslateRetryText("bank", "financial institution");

    expect(parseTranslateInput(encoded)).toEqual({ text: "bank", contextHint: "financial institution" });
  });

  it("round-trips a hashtag-derived context hint without message entities", () => {
    // A callback update carries no entities, so the encoded form must not rely
    // on them to reproduce the original hint.
    const encoded = encodeTranslateRetryText("bank", "#finance");

    expect(parseTranslateInput(encoded)).toEqual({ text: "bank", contextHint: "#finance" });
  });
});

describe("replyWithRetry", () => {
  it("sends the notice with a retry button and remembers what to re-run", async () => {
    const session = makeSession();
    const reply = vi.fn().mockResolvedValue({ message_id: 555 });
    const ctx = { session, reply } as unknown as BotContext;

    await replyWithRetry(ctx, "⌛ timed out", "en", { kind: "translate", text: "Haus" });

    const [text, extra] = reply.mock.calls[0];
    expect(text).toBe("⌛ timed out");
    expect(extra?.reply_markup?.inline_keyboard[0][0].callback_data).toBe(RETRY_CALLBACK);
    expect(takeRetryAction(session, 555)).toMatchObject({ kind: "translate", text: "Haus" });
  });
});
