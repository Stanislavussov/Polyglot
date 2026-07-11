/**
 * Graceful shutdown orchestration (B12).
 *
 * Runs an ordered list of cleanup steps on SIGINT/SIGTERM and guards them with a
 * hard deadline: if a step hangs (a stuck DB close, a socket that won't drain),
 * the deadline fires and force-exits the process instead of lingering until the
 * orchestrator sends SIGKILL. Kept dependency-injected (steps, logger, timers,
 * `forceExit`) so the ordering and deadline behaviour are unit-testable without
 * touching real signals or the process lifecycle.
 */

import { setShuttingDown } from "./liveness-state.js";

/** Minimal structural logger — matches the core pino logger without importing it. */
export interface ShutdownLogger {
  info(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}

/** One named cleanup step; may be synchronous or async. */
export interface ShutdownStep {
  readonly name: string;
  run(): void | Promise<void>;
}

export interface GracefulShutdownConfig {
  /** Cleanup steps, run in order. A failing step is logged and does not abort the rest. */
  readonly steps: readonly ShutdownStep[];
  /** Hard deadline in ms; if cleanup outruns it, {@link GracefulShutdownConfig.forceExit} is called. */
  readonly deadlineMs: number;
  readonly logger: ShutdownLogger;
  /** Force-terminates the process (injected so tests observe it instead of exiting). */
  readonly forceExit: (code: number) => void;
}

/**
 * Builds a shutdown handler. The returned function is idempotent — repeated
 * signals after the first are ignored so cleanup runs exactly once.
 */
export function createGracefulShutdown(config: GracefulShutdownConfig): (signal: string) => Promise<void> {
  let shuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // At the very start of the sequence (before the runner is stopped) so that
    // /livez reads a stopping runner as a graceful shutdown, not a crash (Phase 1a).
    setShuttingDown(true);

    config.logger.info({ signal }, "Received shutdown signal");

    const deadline = setTimeout(() => {
      config.logger.error({ deadlineMs: config.deadlineMs }, "Graceful shutdown exceeded deadline; forcing exit");
      config.forceExit(1);
    }, config.deadlineMs);

    try {
      for (const step of config.steps) {
        try {
          await step.run();
        } catch (err) {
          config.logger.error({ err, step: step.name }, "Shutdown step failed");
        }
      }
    } finally {
      clearTimeout(deadline);
    }

    config.logger.info("Graceful shutdown complete");
  };
}
