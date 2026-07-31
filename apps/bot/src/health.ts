/**
 * Readiness signal for the bot (Fable T12), distinct from the always-ok
 * liveness `/healthz`. Readiness is "not ok" when long-polling looks stuck
 * (no update processed for too long) or the database is unreachable — the two
 * failure modes behind the silent "429 freeze" incident.
 */

import { getRunnerHandle, isShuttingDown, recordLivenessReason } from "./liveness-state.js";

/** Max age of the last processed update before long-polling is deemed stuck. */
export const READINESS_MAX_STALENESS_MS = Number(process.env.READINESS_MAX_STALENESS_MS) || 600_000;

let lastUpdateReceivedAt = Date.now();

/** Heartbeat: called for every update the runner delivers to a handler. */
export function recordUpdateReceived(now: number = Date.now()): void {
  lastUpdateReceivedAt = now;
}

export function getLastUpdateReceivedAt(): number {
  return lastUpdateReceivedAt;
}

export interface ReadinessResult {
  status: "ok" | "error";
  checks: {
    polling: { ok: boolean; lastUpdateAgeMs: number };
    database: { ok: boolean; error?: string };
  };
}

/**
 * Evaluate readiness. `pingDb` is injected so the HTTP layer supplies the real
 * database probe while tests supply a stub — no module mocking required.
 */
export async function checkReadiness(pingDb: () => Promise<void>, now: number = Date.now()): Promise<ReadinessResult> {
  const lastUpdateAgeMs = now - lastUpdateReceivedAt;
  const pollingOk = lastUpdateAgeMs <= READINESS_MAX_STALENESS_MS;

  let dbOk = true;
  let dbError: string | undefined;
  try {
    await pingDb();
  } catch (err) {
    dbOk = false;
    dbError = err instanceof Error ? err.message : "unknown error";
  }

  return {
    status: pollingOk && dbOk ? "ok" : "error",
    checks: {
      polling: { ok: pollingOk, lastUpdateAgeMs },
      database: dbOk ? { ok: true } : { ok: false, error: dbError },
    },
  };
}

/**
 * Threshold-free liveness signal for autoheal (Phase 1a), distinct from `/readyz`
 * (deploy gate) and `/healthz` (always-ok). It reports "not ok" only on the one
 * unambiguous "stuck-or-dead" signal:
 *
 *  1. **Dead runner** — the incident detector: the runner handle is set, we are
 *     not shutting down, yet the runner reports it is no longer running. That is
 *     a silent grammY-runner death (poller stopped, process alive).
 *
 * Deliberately threshold-free otherwise: an idle-but-running bot and a graceful
 * shutdown are both healthy, and there is NO staleness/latency/in-flight belt (a
 * wedged event loop is caught for free by the HTTP probe timing out). Liveness is
 * also deliberately DB-independent — probing the database here would keep a
 * serverless Postgres (Neon) awake around the clock instead of letting it
 * auto-suspend; DB health is checked separately by `checkReadiness`.
 */
export interface LivenessResult {
  status: "ok" | "error";
  reason?: "runner_dead";
  /**
   * True only on the transition INTO `runner_dead` (edge-triggered). Lets the
   * HTTP layer increment `bot_runner_death_detected_total` once per incident
   * instead of once per probe for the whole duration the runner stays dead.
   */
  isNewRunnerDeath?: boolean;
}

export async function checkLiveness(): Promise<LivenessResult> {
  const runner = getRunnerHandle();
  // Boot null-guard: a null handle means the process is still starting — healthy,
  // and never dereferenced (that would 500 during startup).
  if (runner !== null && !isShuttingDown() && !runner.isRunning()) {
    const isNewRunnerDeath = recordLivenessReason("runner_dead");
    return { status: "error", reason: "runner_dead", isNewRunnerDeath };
  }

  recordLivenessReason("ok");
  return { status: "ok" };
}
