import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLiveness,
  checkReadiness,
  getLastUpdateReceivedAt,
  LIVEZ_DB_FAIL_STREAK,
  READINESS_MAX_STALENESS_MS,
  recordUpdateReceived,
} from "./health.js";
import { resetLivenessState, setRunnerHandle, setShuttingDown } from "./liveness-state.js";

const okDb = () => Promise.resolve();
const downDb = () => Promise.reject(new Error("connection refused"));

const runningRunner = { isRunning: () => true };
const deadRunner = { isRunning: () => false };

describe("bot readiness (T12)", () => {
  it("is ok when an update was processed recently and the DB responds", async () => {
    const now = 1_000_000;
    recordUpdateReceived(now);

    const result = await checkReadiness(okDb, now + 1_000);

    expect(result.status).toBe("ok");
    expect(result.checks.polling.ok).toBe(true);
    expect(result.checks.database.ok).toBe(true);
  });

  it("is not ok when long-polling looks stuck (last update too old)", async () => {
    const now = 1_000_000;
    recordUpdateReceived(now);

    const result = await checkReadiness(okDb, now + READINESS_MAX_STALENESS_MS + 1);

    expect(result.status).toBe("error");
    expect(result.checks.polling.ok).toBe(false);
    expect(result.checks.polling.lastUpdateAgeMs).toBeGreaterThan(READINESS_MAX_STALENESS_MS);
  });

  it("is not ok when the database ping fails", async () => {
    const now = 1_000_000;
    recordUpdateReceived(now);

    const result = await checkReadiness(downDb, now);

    expect(result.status).toBe("error");
    expect(result.checks.database.ok).toBe(false);
    expect(result.checks.database.error).toBe("connection refused");
  });

  it("records the heartbeat timestamp", () => {
    recordUpdateReceived(12_345);
    expect(getLastUpdateReceivedAt()).toBe(12_345);
  });
});

describe("bot liveness (/livez, Phase 1a)", () => {
  beforeEach(() => {
    resetLivenessState();
  });

  it("is unhealthy when the runner is set, running has stopped, and we are NOT shutting down (the incident)", async () => {
    setRunnerHandle(deadRunner);

    const result = await checkLiveness(okDb);

    expect(result.status).toBe("error");
    expect(result.reason).toBe("runner_dead");
  });

  it("is healthy when the runner has stopped but we are shutting down (graceful stop, not a crash)", async () => {
    setRunnerHandle(deadRunner);
    setShuttingDown(true);

    const result = await checkLiveness(okDb);

    expect(result.status).toBe("ok");
  });

  it("is healthy when the runner is running and idle (no traffic is normal — no staleness threshold)", async () => {
    setRunnerHandle(runningRunner);

    const result = await checkLiveness(okDb);

    expect(result.status).toBe("ok");
  });

  it("is healthy while booting (runner handle not set yet) and MUST NOT throw on the null handle", async () => {
    // No setRunnerHandle call — the handle is null during startup.
    await expect(checkLiveness(okDb)).resolves.toEqual({ status: "ok" });
  });

  it("stays healthy on a single DB failure but trips after LIVEZ_DB_FAIL_STREAK consecutive failures", async () => {
    setRunnerHandle(runningRunner);

    for (let i = 1; i < LIVEZ_DB_FAIL_STREAK; i++) {
      expect((await checkLiveness(downDb)).status).toBe("ok");
    }

    const tripped = await checkLiveness(downDb);
    expect(tripped.status).toBe("error");
    expect(tripped.reason).toBe("db_dead");
  });

  it("resets the DB failure streak on any success mid-streak", async () => {
    setRunnerHandle(runningRunner);

    for (let i = 1; i < LIVEZ_DB_FAIL_STREAK; i++) {
      await checkLiveness(downDb);
    }
    // A success clears the streak...
    expect((await checkLiveness(okDb)).status).toBe("ok");
    // ...so the next failure starts counting from one again, still healthy.
    expect((await checkLiveness(downDb)).status).toBe("ok");
  });

  it("flags the first runner_dead check as a new death (edge-trigger for bot_runner_death_detected_total)", async () => {
    setRunnerHandle(deadRunner);

    const first = await checkLiveness(okDb);

    expect(first.reason).toBe("runner_dead");
    expect(first.isNewRunnerDeath).toBe(true);
  });

  it("does not flag a second consecutive runner_dead check as a new death (still dead, not a second death)", async () => {
    setRunnerHandle(deadRunner);
    await checkLiveness(okDb);

    const second = await checkLiveness(okDb);

    expect(second.reason).toBe("runner_dead");
    expect(second.isNewRunnerDeath).toBe(false);
  });

  it("flags a new death again after recovering and dying a second time", async () => {
    setRunnerHandle(deadRunner);
    await checkLiveness(okDb); // first death

    setRunnerHandle(runningRunner);
    expect((await checkLiveness(okDb)).status).toBe("ok"); // recovered

    setRunnerHandle(deadRunner);
    const secondDeath = await checkLiveness(okDb);

    expect(secondDeath.isNewRunnerDeath).toBe(true);
  });
});
