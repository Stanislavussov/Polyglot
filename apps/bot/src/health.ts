/**
 * Readiness signal for the bot (Fable T12), distinct from the always-ok
 * liveness `/healthz`. Readiness is "not ok" when long-polling looks stuck
 * (no update processed for too long) or the database is unreachable — the two
 * failure modes behind the silent "429 freeze" incident.
 */

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
