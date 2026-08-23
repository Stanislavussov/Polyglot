import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  systemSettingsRepository: { get: mocks.get, set: mocks.set },
}));

const { sttRoutes } = await import("./stt.js");
const { FALLBACK_STT } = await import("@polyglot/core");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(sttRoutes);
  return app;
}

const fetchMock = vi.fn();

beforeEach(() => {
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /stt", () => {
  it("serves the shared default when nothing is stored", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/stt" });

    expect(res.statusCode).toBe(200);
    // Must equal the runtime default exactly — a route-local copy is how the admin
    // panel and the bot drift apart on what the shipped configuration actually is.
    expect(res.json()).toEqual(FALLBACK_STT);
  });

  it("backfills fields missing from a partial stored blob", async () => {
    // A row written before a field existed must not surface that field as undefined.
    mocks.get.mockResolvedValue({ enabled: false, modelId: "other/model" });
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/stt" })).json();

    expect(body).toEqual({ ...FALLBACK_STT, enabled: false, modelId: "other/model" });
  });
});

describe("PUT /stt", () => {
  it("persists a valid config under the stt key", async () => {
    const app = await buildApp();
    const payload = { enabled: true, modelId: "openai/whisper-large-v3-turbo", maxDurationSec: 90 };

    const res = await app.inject({ method: "PUT", url: "/stt", payload });

    expect(res.statusCode).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith("stt", payload);
  });

  it("rejects an enabled config with no model rather than storing a dead feature", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/stt",
      payload: { enabled: true, modelId: "", maxDurationSec: 60 },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("GET /stt/models", () => {
  it("returns transcription models with per-second pricing", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "z/late", name: "Zeta", pricing: { prompt: "0.000015" } },
            { id: "a/early", name: "Alpha", pricing: { prompt: "0.00000333" } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/stt/models" })).json();

    expect(fetchMock.mock.calls[0]![0]).toContain("output_modalities=transcription");
    expect(body).toEqual([
      { id: "a/early", name: "Alpha", pricing: { prompt: "0.00000333" } },
      { id: "z/late", name: "Zeta", pricing: { prompt: "0.000015" } },
    ]);
  });
});
