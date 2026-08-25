import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  systemSettingsRepository: { get: mocks.get, set: mocks.set },
}));

const { mentorRoutes } = await import("./mentor.js");
const { FALLBACK_MENTOR } = await import("@polyglot/core");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(mentorRoutes);
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

describe("GET /mentor", () => {
  it("serves the shared default when nothing is stored", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/mentor" });

    expect(res.statusCode).toBe(200);
    // Must equal the runtime default exactly — a route-local copy is how the admin
    // panel and the bot drift apart on what the shipped configuration actually is.
    expect(res.json()).toEqual(FALLBACK_MENTOR);
  });

  it("backfills fields missing from a partial stored blob", async () => {
    mocks.get.mockResolvedValue({ modelId: "anthropic/claude-sonnet-5" });
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/mentor" })).json();

    expect(body).toEqual({ ...FALLBACK_MENTOR, modelId: "anthropic/claude-sonnet-5" });
  });
});

describe("PUT /mentor", () => {
  it("persists a valid config under the mentor key", async () => {
    const app = await buildApp();
    const payload = { modelId: "anthropic/claude-sonnet-5", maxTokens: 900 };

    const res = await app.inject({ method: "PUT", url: "/mentor", payload });

    expect(res.statusCode).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith("mentor", payload);
  });

  it("accepts an empty model — it means the default chain, not a dead feature", async () => {
    const app = await buildApp();
    const payload = { modelId: "", maxTokens: 700 };

    const res = await app.inject({ method: "PUT", url: "/mentor", payload });

    expect(res.statusCode).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith("mentor", payload);
  });

  it("rejects an out-of-range token cap rather than storing a broken turn budget", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "PUT", url: "/mentor", payload: { modelId: "", maxTokens: 10 } });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("GET /mentor/models", () => {
  it("returns text-out chat models sorted by name, hiding :variant routes", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "z/chat",
              name: "Zeta",
              pricing: { prompt: "0.000002", completion: "0.00001" },
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "a/chat",
              name: "Alpha",
              pricing: { prompt: "0.000001", completion: "0.000002" },
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "a/chat:free",
              name: "Alpha (free)",
              pricing: { prompt: "0", completion: "0" },
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "t/speech",
              name: "Talker",
              pricing: { prompt: "0.000001" },
              architecture: { output_modalities: ["audio"] },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/mentor/models" })).json();

    expect(body).toEqual([
      { id: "a/chat", name: "Alpha", pricing: { prompt: "0.000001", completion: "0.000002" } },
      { id: "z/chat", name: "Zeta", pricing: { prompt: "0.000002", completion: "0.00001" } },
    ]);
  });
});
