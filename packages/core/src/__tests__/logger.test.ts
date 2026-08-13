import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { LOG_REDACT_PATHS } from "../logger.js";

/** Builds a pino logger with the production redact config writing to memory. */
function capture(level: string) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const log = pino({ level, redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" } }, stream);
  return { log, records: () => lines.map((l) => JSON.parse(l)) };
}

describe("logger PII redaction", () => {
  it("keeps user message text so a failing input can be reproduced", () => {
    const { log, records } = capture("info");

    log.info({ text: "hello my secret message", userId: 7 }, "routed");

    const [rec] = records();
    expect(rec.text).toBe("hello my secret message");
    expect(rec.userId).toBe(7);
  });

  it("redacts username at every nesting level, since ids already identify the user", () => {
    const { log, records } = capture("info");

    log.info({ username: "alice_pii", payload: { username: "bob" } }, "routed");

    const [rec] = records();
    expect(rec.username).toBe("[Redacted]");
    expect(rec.payload.username).toBe("[Redacted]");
  });

  it("keeps diagnostic surrogates (textLength, textPreview) so diagnostic value is preserved", () => {
    const { log, records } = capture("debug");

    log.debug({ textLength: 23, textPreview: "hello my secret messa", userId: 7 }, "diag");

    const [rec] = records();
    expect(rec.textLength).toBe(23);
    expect(rec.textPreview).toBe("hello my secret messa");
  });

  it("redacts a password field as defense-in-depth", () => {
    const { log, records } = capture("info");

    log.info({ password: "hunter2" }, "should never happen");

    expect(records()[0].password).toBe("[Redacted]");
  });
});
