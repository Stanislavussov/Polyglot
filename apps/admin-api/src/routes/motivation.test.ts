import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  systemSettingsRepository: { get: mocks.get, set: mocks.set },
}));

const { motivationRoutes } = await import("./motivation.js");
const { DEFAULT_MOTIVATION_CONFIG } = await import("@polyglot/core");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(motivationRoutes);
  return app;
}

beforeEach(() => {
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /motivation", () => {
  it("serves the shared default when nothing is stored", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/motivation" });

    expect(res.statusCode).toBe(200);
    // Must equal the runtime default exactly — a route-local copy is how the
    // panel and the bot drift apart on which surfaces are actually live.
    expect(res.json()).toEqual(DEFAULT_MOTIVATION_CONFIG);
  });

  it("shows the panel what the runtime sees, not what the row says", async () => {
    // A hand-edited row the runtime will refuse. Echoing it back would tell the
    // operator praise is on while the bot renders nothing.
    mocks.get.mockResolvedValue({ recordingEnabled: true, enabled: true, praiseEnabled: "on" });
    const app = await buildApp();

    expect((await app.inject({ method: "GET", url: "/motivation" })).json()).toEqual({
      recordingEnabled: true,
      enabled: true,
      praiseEnabled: false,
      recoveryEnabled: false,
    });
  });
});

describe("PUT /motivation", () => {
  it("persists all four switches under the motivation key", async () => {
    const app = await buildApp();
    const payload = { recordingEnabled: true, enabled: true, praiseEnabled: false, recoveryEnabled: true };

    const res = await app.inject({ method: "PUT", url: "/motivation", payload });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(payload);
    expect(mocks.set).toHaveBeenCalledWith("motivation", payload);
  });

  it("rejects a non-boolean switch rather than storing something un-flippable", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/motivation",
      payload: { recordingEnabled: true, enabled: "false", praiseEnabled: false, recoveryEnabled: false },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("rejects a partial body — a missing key would leave a stale switch live", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/motivation",
      payload: { recordingEnabled: true, enabled: false },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
