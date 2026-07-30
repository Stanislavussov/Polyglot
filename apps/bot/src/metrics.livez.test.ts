/**
 * Integration tests for the real `/livez` HTTP handler (Phase 1a): the metrics
 * server, the `checkLiveness` handler, and the `liveness-state` singleton wired
 * together over a real socket — no stubbed `checkLiveness`. Only the DB ping is
 * injected (so the test is hermetic) and the runner handle is driven through the
 * public `liveness-state` API.
 */
import { get, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
});

import { resetLivenessState, setRunnerHandle } from "./liveness-state.js";
import { closeMetricsServer, runnerDeathCounter, startMetricsServer } from "./metrics.js";

const okDb = () => Promise.resolve();

let server: Server | null = null;

async function listeningPort(s: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    if (s.listening) return resolve();
    s.once("listening", () => resolve());
  });
  const addr = s.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("metrics server did not bind a port");
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    }).on("error", reject);
  });
}

async function livez(): Promise<{ status: number; body: string }> {
  // Port 0 asks the OS for a free ephemeral port so parallel test files never collide.
  server = startMetricsServer(okDb, 0);
  const port = await listeningPort(server);
  return httpGet(`http://127.0.0.1:${port}/livez`);
}

beforeEach(() => {
  resetLivenessState();
  runnerDeathCounter.reset();
});

afterEach(async () => {
  await closeMetricsServer(server);
  server = null;
});

describe("/livez endpoint (Phase 1a)", () => {
  it("responds 503 when the injected runner reports it has stopped running (dead poller)", async () => {
    setRunnerHandle({ isRunning: () => false });

    const res = await livez();

    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toMatchObject({ status: "unhealthy", reason: "runner_dead" });
  });

  it("responds 200 when the runner is running and idle", async () => {
    setRunnerHandle({ isRunning: () => true });

    const res = await livez();

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "ok" });
  });

  it("responds 200 before any runner handle is set (booting) without a 500", async () => {
    // No setRunnerHandle — the boot null-guard must hold over the real handler.
    const res = await livez();

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "ok" });
  });

  it("increments bot_runner_death_detected_total once per death, not once per probe while still dead", async () => {
    setRunnerHandle({ isRunning: () => false });
    server = startMetricsServer(okDb, 0);
    const port = await listeningPort(server);

    await httpGet(`http://127.0.0.1:${port}/livez`);
    await httpGet(`http://127.0.0.1:${port}/livez`);
    await httpGet(`http://127.0.0.1:${port}/livez`);

    const { values } = await runnerDeathCounter.get();
    expect(values[0]?.value).toBe(1);
  });

  it("responds 200 even when the injected DB ping rejects — /livez must never depend on the database (Neon auto-suspend)", async () => {
    const rejectingDb = () => Promise.reject(new Error("db down"));
    setRunnerHandle({ isRunning: () => true });
    server = startMetricsServer(rejectingDb, 0);
    const port = await listeningPort(server);

    const res = await httpGet(`http://127.0.0.1:${port}/livez`);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "ok" });
  });
});
