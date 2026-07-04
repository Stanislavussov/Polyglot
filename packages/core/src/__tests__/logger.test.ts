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

describe("logger PII redaction (T10)", () => {
  it("redacts user message text and username at info level (shipped to Betterstack)", () => {
    const { log, records } = capture("info");

    log.info({ text: "hello my secret message", username: "alice_pii", userId: 7 }, "routed");

    const [rec] = records();
    expect(rec.text).toBe("[Redacted]");
    expect(rec.username).toBe("[Redacted]");
    // Non-PII identifiers stay for diagnostics.
    expect(rec.userId).toBe(7);
  });

  it("redacts nested text/username paths", () => {
    const { log, records } = capture("info");

    log.info({ payload: { text: "secret", username: "bob" } }, "nested");

    const [rec] = records();
    expect(rec.payload.text).toBe("[Redacted]");
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
