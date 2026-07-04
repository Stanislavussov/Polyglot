import { describe, expect, it } from "vitest";
import { checkReadiness, getLastUpdateReceivedAt, READINESS_MAX_STALENESS_MS, recordUpdateReceived } from "./health.js";

const okDb = () => Promise.resolve();
const downDb = () => Promise.reject(new Error("connection refused"));

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
