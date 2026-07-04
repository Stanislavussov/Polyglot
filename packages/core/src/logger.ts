/**
 * Core logger — singleton pino instance.
 *
 * Core uses pino directly so that adapters and other packages consuming
 * core get structured logging without needing their own logger setup.
 *
 * Call sites use the Logger interface (info/warn/error/debug) with
 * (obj, msg) signature — pino matches this natively.
 *
 * Betterstack transport (tech-reqs/16-logging.md) can be wired in the
 * composition root (apps/bot) by replacing the pino export with one
 * that writes to Logtail.
 */
import pino from "pino";

/**
 * PII / secret field paths redacted from every log record (T10/S7). Logs are
 * shipped to Betterstack/Loki — a third party — so user message text and
 * usernames (PII) and any password field are replaced with `[Redacted]`.
 * Diagnostic surrogates are deliberately NOT listed and stay visible:
 * `textLength` (a length category) and `textPreview` (debug-only, never shipped
 * because prod runs at level `info`), plus ids like `userId`/`telegramId`.
 */
export const LOG_REDACT_PATHS = ["text", "*.text", "username", "*.username", "password", "*.password"];

const coreLogger = pino(
  { level: "info", redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" } },
  pino.destination(1),
);

export { coreLogger as logger };
export default coreLogger;

// Also re-export the interface/getter/setter for internal core modules
// that import from this file via relative path (e.g. ../../logger.js)
export type { Logger } from "./logger-interface.js";
export { getLogger, setLogger } from "./logger-interface.js";
