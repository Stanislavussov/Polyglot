/**
 * Ambient trace context — the backbone of reproducible debugging.
 *
 * Every unit of work that originates outside the process (a Telegram update, a
 * scheduled notification run, a CLI script) opens a trace. Everything that runs
 * underneath it — bot handlers, core services, DB and AI adapters — shares that
 * trace through {@link AsyncLocalStorage}, so the logger can stamp `traceId`
 * and `userId` onto every record without a single call site threading them
 * through its arguments.
 *
 * That is what makes a Loki query like
 *   {container_name="polyglot-bot"} | json | traceId="a1b2c3d4e5f6"
 * return the *entire* causal chain of one button tap: the update, the handler,
 * the AI calls, the validation retries and the outgoing Telegram replies.
 *
 * Concurrency: @grammyjs/runner processes updates concurrently in one process.
 * AsyncLocalStorage keeps one store per async execution path, so two updates in
 * flight never observe each other's trace.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

/**
 * Identifying fields carried by every log line produced inside a trace.
 * Deliberately small: anything larger belongs in the individual log record, not
 * in ambient state repeated on every line.
 */
export interface TraceContext {
  /** Correlates every record of one unit of work. */
  traceId: string;
  /** What opened the trace, e.g. `telegram.update` or `cron.notifications`. */
  source: string;
  /** Neutral internal user id — set once auth resolves it. */
  userId?: number;
  /** Telegram user id — known before the DB lookup, so both are kept. */
  telegramId?: number;
  chatId?: number;
  updateId?: number;
  /** Job identity for background traces (scheduler tick, retention run, …). */
  jobName?: string;
  /**
   * Trace that spawned this one. Background batches open a trace per tick and a
   * child trace per user, so one delivery is followable on its own while still
   * being attributable to the batch that scheduled it.
   */
  parentTraceId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** 12 hex chars: short enough to eyeball in Grafana, wide enough not to collide. */
export function newTraceId(): string {
  return randomBytes(6).toString("hex");
}

/**
 * Run `fn` inside a fresh trace. The returned value (including a promise) is
 * passed through untouched, so this wraps both sync and async work.
 */
export function runWithTrace<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active trace, or undefined when running outside one. */
export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * The active trace flattened into log fields, for the logger's pino `mixin`.
 *
 * Returns `{}` outside a trace so records written at startup or from a CLI
 * script stay clean rather than carrying null-ish identity fields. Undefined
 * members are omitted for the same reason — a field present in a log record
 * should mean the value is known.
 */
export function traceLogFields(): Record<string, string | number> {
  const trace = storage.getStore();
  if (!trace) return {};
  return {
    traceId: trace.traceId,
    source: trace.source,
    ...(trace.userId !== undefined && { userId: trace.userId }),
    ...(trace.telegramId !== undefined && { telegramId: trace.telegramId }),
    ...(trace.chatId !== undefined && { chatId: trace.chatId }),
    ...(trace.updateId !== undefined && { updateId: trace.updateId }),
    ...(trace.jobName !== undefined && { jobName: trace.jobName }),
    ...(trace.parentTraceId !== undefined && { parentTraceId: trace.parentTraceId }),
  };
}

/**
 * Merge late-resolved fields into the active trace (typically `userId`, which
 * is only known after the auth middleware has hit the database). Mutating the
 * store is intentional: every already-captured reference sees the enrichment,
 * so logs emitted before and after auth share the same identity fields.
 * A no-op outside a trace, so call sites need no guard.
 */
export function enrichTrace(fields: Partial<TraceContext>): void {
  const store = storage.getStore();
  if (!store) return;
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      Object.assign(store, { [key]: value });
    }
  }
}
