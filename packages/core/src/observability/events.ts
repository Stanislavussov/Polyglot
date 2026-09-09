/**
 * Structured event emission.
 *
 * Every deliberate observability record goes through here rather than through a
 * bare `logger.info`, so all of them share one shape:
 *
 *   { "event": "dictionary.entry.deleted", "traceId": "…", "userId": 42, … }
 *
 * The stable `event` field is what makes the logs queryable instead of merely
 * readable — `| json | event="translation.failed"` in Loki beats grepping free
 * text for a message someone reworded. Trace fields are attached by the logger
 * itself (see logger.ts), so call sites pass only what is specific to the event.
 *
 * Event names are dot-delimited and ordered general → specific
 * (`<area>.<subject>.<outcome>`); the catalogue lives in
 * `@docs/agents/observability.md`.
 */
import { getLogger } from "../logger-interface.js";

export type EventLevel = "debug" | "info" | "warn" | "error";

export type EventFields = Record<string, unknown>;

/**
 * Emit one structured event.
 *
 * Never throws: observability must not be able to take down the flow it is
 * observing. A logger that fails (a broken transport, a serialisation error on
 * an exotic field) is swallowed rather than surfaced to the user.
 */
export function logEvent(event: string, fields: EventFields = {}, level: EventLevel = "info"): void {
  try {
    getLogger()[level]({ event, ...fields }, event);
  } catch {
    // Intentionally empty — see above.
  }
}

/** Serialise an unknown thrown value into log-safe fields. */
export function errorFields(error: unknown): EventFields {
  if (error instanceof Error) {
    return {
      error: error.message,
      errorName: error.name,
      ...(error.stack !== undefined && { stack: error.stack }),
      ...(error.cause !== undefined && { errorCause: String(error.cause) }),
    };
  }
  return { error: String(error) };
}

/**
 * Wrap an operation in a started/finished/failed event triplet with a duration.
 *
 * The `started` record is what makes a hang diagnosable: when an operation never
 * returns there is no `finished` line to read, and the dangling `started` names
 * both the operation and the trace it belongs to. It is emitted at debug level
 * so normal production volume stays at one line per completed operation.
 *
 * The original error is rethrown unchanged — this only observes.
 */
export async function tracedOperation<T>(
  event: string,
  fields: EventFields,
  operation: () => Promise<T>,
  /** Merge result-derived fields (counts, ids, outcome) into the `finished` record. */
  describeResult?: (result: T) => EventFields,
): Promise<T> {
  const startedAt = Date.now();
  logEvent(`${event}.started`, fields, "debug");
  try {
    const result = await operation();
    logEvent(`${event}.finished`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      ...(describeResult ? describeResult(result) : {}),
    });
    return result;
  } catch (error) {
    logEvent(`${event}.failed`, { ...fields, durationMs: Date.now() - startedAt, ...errorFields(error) }, "error");
    throw error;
  }
}
