/**
 * Test helper: capture the real event stream.
 *
 * Installs a collecting logger through core's `setLogger`, the same seam the
 * composition root uses, so tests exercise `logEvent`/`tracedOperation` for real
 * instead of asserting against a mock of them.
 */
import { type Logger, setLogger } from "@polyglot/core";

export interface CapturedEvent {
  level: keyof Logger;
  event: string;
  fields: Record<string, unknown>;
}

export interface EventCollector {
  events: CapturedEvent[];
  /** Events with the given name, in emission order. */
  named(event: string): CapturedEvent[];
  /** Every event name emitted, in order. */
  names(): string[];
  reset(): void;
}

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export function collectEvents(): EventCollector {
  const events: CapturedEvent[] = [];
  const capture =
    (level: keyof Logger) =>
    (fields: Record<string, unknown>, _msg: string): void => {
      events.push({ level, event: String(fields.event ?? _msg), fields });
    };

  setLogger({ debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") });

  return {
    events,
    named: (event) => events.filter((e) => e.event === event),
    names: () => events.map((e) => e.event),
    reset: () => {
      events.length = 0;
    },
  };
}

/** Restore the silent default so one test's logger cannot leak into the next. */
export function stopCollecting(): void {
  setLogger(silent);
}
