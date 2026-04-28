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

const coreLogger = pino({ level: "info" }, pino.destination(1));

export { coreLogger as logger };
export default coreLogger;

// Also re-export the interface/getter/setter for internal core modules
// that import from this file via relative path (e.g. ../../logger.js)
export type { Logger } from "./logger-interface.js";
export { getLogger, setLogger } from "./logger-interface.js";
