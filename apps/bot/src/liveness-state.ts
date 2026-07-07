/**
 * Threshold-free liveness state (Phase 1a). A leaf module holding the raw
 * signals `/livez` reads: the grammY runner handle (null until boot), the
 * shutting-down flag, and the consecutive DB-probe failure streak.
 *
 * It imports nothing from health/metrics/index/shutdown so it can never close an
 * import cycle — every other module depends on it, not the other way round.
 */

/** Minimal structural view of a runner handle — anything that can report whether it is running. */
export interface LivenessRunner {
  isRunning(): boolean;
}

let runnerHandle: LivenessRunner | null = null;
let shuttingDown = false;
let dbFailStreak = 0;

/** Records the runner handle once the runner has been started (see index.ts). */
export function setRunnerHandle(handle: LivenessRunner): void {
  runnerHandle = handle;
}

/** The runner handle, or `null` while the process is still booting. */
export function getRunnerHandle(): LivenessRunner | null {
  return runnerHandle;
}

/** Marks that graceful shutdown has begun so a stopping runner is not read as a crash. */
export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Records a DB-probe outcome and returns the current consecutive-failure streak.
 * A success resets the streak to zero; a failure increments it. Callers compare
 * the returned streak against a threshold to decide whether the DB is dead.
 *
 * Assumes a single liveness prober (the Docker HEALTHCHECK hitting `/livez` on
 * its own cadence). The "N consecutive" semantics are not safe under concurrent
 * probers — two callers racing `recordDbProbe` would interleave and corrupt the
 * streak (e.g. a genuine 3-in-a-row failure could be masked by an interleaved
 * success from the other prober, or vice versa).
 */
export function recordDbProbe(ok: boolean): number {
  dbFailStreak = ok ? 0 : dbFailStreak + 1;
  return dbFailStreak;
}

type LivenessReason = "ok" | "runner_dead" | "db_dead";

let lastLivenessReason: LivenessReason = "ok";

/**
 * Records the most recent `/livez` outcome and reports whether this call is the
 * transition INTO `runner_dead` (i.e. the previous recorded reason was not
 * already `runner_dead`). Used to edge-trigger `bot_runner_death_detected_total`
 * so the counter means "deaths," not "probes observed while dead" — a single
 * incident must not inflate the total once per probe for the whole dead window.
 */
export function recordLivenessReason(reason: LivenessReason): boolean {
  const enteredRunnerDead = reason === "runner_dead" && lastLivenessReason !== "runner_dead";
  lastLivenessReason = reason;
  return enteredRunnerDead;
}

/** Resets all liveness state to its initial values — for test isolation. */
export function resetLivenessState(): void {
  runnerHandle = null;
  shuttingDown = false;
  dbFailStreak = 0;
  lastLivenessReason = "ok";
}
