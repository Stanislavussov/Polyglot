/**
 * Core logger — singleton pino instance.
 *
 * Core uses pino directly so that adapters and other packages consuming
 * core get structured logging without needing their own logger setup.
 *
 * Call sites use the Logger interface (info/warn/error/debug) with
 * (obj, msg) signature — pino matches this natively.
 *
 * Records go to stdout, where promtail picks them up and ships them to the
 * self-hosted Loki behind Grafana (deploy/monitoring/). Nothing leaves the VPS.
 */
import pino from "pino";
import { traceLogFields } from "./observability/trace-context.js";

/**
 * PII / secret field paths redacted from every log record.
 *
 * `username` is redacted because `userId`/`telegramId` already identify a user
 * for debugging, so the handle adds exposure without adding diagnostic value.
 * `password` is defense-in-depth — no code path should ever log one.
 *
 * User message `text` is deliberately NOT redacted: reproducing a translation
 * bug means knowing the exact input that produced it, and logs now stay on our
 * own infrastructure (self-hosted Loki) rather than a third-party log service.
 * That makes Loki retention the control that bounds this data — see
 * `@docs/agents/observability.md`.
 */
export const LOG_REDACT_PATHS = ["username", "*.username", "password", "*.password"];

/**
 * `LOG_LEVEL=debug` turns on the high-volume half of the event stream: handler
 * start records, outgoing message bodies, and per-phase pipeline timings. Prod
 * runs at `info`; flip a container to `debug` while chasing an incident.
 */
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const coreLogger = pino(
  {
    level: LOG_LEVEL,
    redact: { paths: LOG_REDACT_PATHS, censor: "[Redacted]" },
    /**
     * Stamps the ambient trace onto every record, so a log line written deep in
     * a core service or a DB adapter is still attributable to the Telegram
     * update that caused it. Fields explicitly passed by the call site win over
     * these (pino merges the log object over the mixin).
     */
    mixin: traceLogFields,
  },
  pino.destination(1),
);

export { coreLogger as logger };
export default coreLogger;

// Also re-export the interface/getter/setter for internal core modules
// that import from this file via relative path (e.g. ../../logger.js)
export type { Logger } from "./logger-interface.js";
export { getLogger, setLogger } from "./logger-interface.js";
