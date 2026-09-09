import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../../logger-interface.js";
import { setLogger } from "../../logger-interface.js";
import { errorFields, logEvent, tracedOperation } from "../events.js";

interface Record_ {
  level: keyof Logger;
  fields: Record<string, unknown>;
  msg: string;
}

let records: Record_[] = [];

function collector(): Logger {
  const capture =
    (level: keyof Logger) =>
    (fields: Record<string, unknown>, msg: string): void => {
      records.push({ level, fields, msg });
    };
  return { debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") };
}

function eventNames(): string[] {
  return records.map((r) => String(r.fields.event));
}

beforeEach(() => {
  records = [];
  setLogger(collector());
});

afterEach(() => {
  setLogger({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
});

describe("logEvent", () => {
  it("emits the event name as both a queryable field and the message", () => {
    logEvent("dictionary.entry.deleted", { entryId: 7 });

    expect(records).toEqual([
      { level: "info", fields: { event: "dictionary.entry.deleted", entryId: 7 }, msg: "dictionary.entry.deleted" },
    ]);
  });

  it("honours the requested level", () => {
    logEvent("translation.validation.retry", {}, "warn");

    expect(records[0]?.level).toBe("warn");
  });

  it("never throws when the logger itself fails, so logging cannot break a flow", () => {
    setLogger({
      debug: () => {},
      info: () => {
        throw new Error("transport gone");
      },
      warn: () => {},
      error: () => {},
    });

    expect(() => logEvent("anything")).not.toThrow();
  });
});

describe("tracedOperation", () => {
  it("brackets a successful operation with a debug start and an info finish carrying duration", async () => {
    const result = await tracedOperation("translation.request", { word: "Haus" }, async () => "done");

    expect(result).toBe("done");
    expect(eventNames()).toEqual(["translation.request.started", "translation.request.finished"]);
    expect(records[0]?.level).toBe("debug");
    expect(records[1]?.fields.word).toBe("Haus");
    expect(records[1]?.fields.durationMs).toEqual(expect.any(Number));
  });

  it("merges result-derived fields into the finish record", async () => {
    await tracedOperation(
      "dictionary.page",
      { page: 2 },
      async () => ({ entries: [1, 2, 3] }),
      (r) => ({ entryCount: r.entries.length }),
    );

    expect(records[1]?.fields.entryCount).toBe(3);
  });

  it("logs a failure with the error details and rethrows the original error", async () => {
    const boom = new Error("AI timed out");

    await expect(tracedOperation("translation.request", { word: "Haus" }, () => Promise.reject(boom))).rejects.toBe(
      boom,
    );

    expect(eventNames()).toEqual(["translation.request.started", "translation.request.failed"]);
    const failure = records[1];
    expect(failure?.level).toBe("error");
    expect(failure?.fields.error).toBe("AI timed out");
    expect(failure?.fields.durationMs).toEqual(expect.any(Number));
  });

  it("leaves no finish record when the operation never settles, so a hang is visible as a dangling start", async () => {
    let release: (() => void) | undefined;
    const pending = tracedOperation("mentor.turn", {}, () => new Promise<void>((resolve) => (release = resolve)));

    await Promise.resolve();
    expect(eventNames()).toEqual(["mentor.turn.started"]);

    release?.();
    await pending;
    expect(eventNames()).toEqual(["mentor.turn.started", "mentor.turn.finished"]);
  });
});

describe("errorFields", () => {
  it("unpacks an Error into message, name and stack", () => {
    const fields = errorFields(new TypeError("bad input"));

    expect(fields.error).toBe("bad input");
    expect(fields.errorName).toBe("TypeError");
    expect(fields.stack).toEqual(expect.stringContaining("TypeError"));
  });

  it("stringifies a non-Error throw", () => {
    expect(errorFields("plain string")).toEqual({ error: "plain string" });
  });
});
