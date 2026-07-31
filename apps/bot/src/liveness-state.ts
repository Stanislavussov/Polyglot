/**
 * Threshold-free liveness state (Phase 1a). A leaf module holding the raw
 * signals `/livez` reads: the grammY runner handle (null until boot) and the
 * shutting-down flag.
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

type LivenessReason = "ok" | "runner_dead";

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
  lastLivenessReason = "ok";
}
