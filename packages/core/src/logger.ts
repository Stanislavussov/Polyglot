/**
 * Core logger abstraction.
 *
 * Core must stay free of infrastructure dependencies (clean arch),
 * so we define a minimal logger interface here. The composition root
 * (apps/bot) injects the real pino logger at startup via `setLogger()`.
 *
 * Default: no-op (silent) — the app MUST call setLogger() before
 * any translation/validation work happens.
 */

export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

/** No-op logger used before setLogger() is called. */
const noop = () => {};
const noopLogger: Logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
};

let currentLogger: Logger = noopLogger;

/** Get the current logger instance. */
export function getLogger(): Logger {
  return currentLogger;
}

/**
 * Inject the real logger (called once from the composition root).
 * Pino is compatible — its `.info(obj, msg)` signature matches.
 */
export function setLogger(logger: Logger): void {
  currentLogger = logger;
}
