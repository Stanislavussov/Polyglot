import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  systemSettingsRepository: { get: mocks.get, set: mocks.set },
}));

const { ttsRoutes } = await import("./tts.js");
const { FALLBACK_TTS } = await import("@polyglot/core");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(ttsRoutes);
  return app;
}

/** Minimal stand-in for a successful `/audio/speech` call returning mp3. */
function mp3Response(bytes = new Uint8Array([0xff, 0xfb, 0x00, 0x00])): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "audio/mpeg" } });
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

describe("GET /tts", () => {
  it("serves the shared default when nothing is stored", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/tts" });

    expect(res.statusCode).toBe(200);
    // Must equal the runtime default exactly — a route-local copy is how the admin
    // panel and the bot drift apart on what the shipped configuration actually is.
    expect(res.json()).toEqual(FALLBACK_TTS);
  });

  it("backfills fields missing from a partial stored blob", async () => {
    // A row written before a field existed must not surface that field as undefined.
    mocks.get.mockResolvedValue({ enabled: false, modelId: "other/model" });
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/tts" })).json();

    expect(body).toEqual({ ...FALLBACK_TTS, enabled: false, modelId: "other/model" });
  });
});

describe("PUT /tts", () => {
  it("persists a valid config under the tts key", async () => {
    const app = await buildApp();
    const payload = { enabled: true, modelId: "x-ai/grok-voice-tts-1.0", voice: "eve", maxChars: 200 };

    const res = await app.inject({ method: "PUT", url: "/tts", payload });

    expect(res.statusCode).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith("tts", payload);
  });

  it("rejects an enabled config with no model rather than storing a dead feature", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/tts",
      payload: { enabled: true, modelId: "", voice: "eve", maxChars: 200 },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});

describe("GET /tts/models", () => {
  it("returns speech models with voices and a per-million-character price", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "z/late", name: "Zeta", pricing: { prompt: "0.000015" }, supported_voices: ["eve"] },
            { id: "a/early", name: "Alpha", pricing: { prompt: "0.00000062" }, supported_voices: null },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const app = await buildApp();

    const body = (await app.inject({ method: "GET", url: "/tts/models" })).json();

    expect(fetchMock.mock.calls[0]![0]).toContain("output_modalities=speech");
    expect(body).toEqual([
      { id: "a/early", name: "Alpha", voices: [], pricePerMillionChars: 0.62 },
      { id: "z/late", name: "Zeta", voices: ["eve"], pricePerMillionChars: 15 },
    ]);
  });
});

describe("POST /tts/probe", () => {
  it("reports success with the size and content type of what came back", async () => {
    fetchMock.mockResolvedValue(mp3Response());
    const app = await buildApp();

    const body = (
      await app.inject({
        method: "POST",
        url: "/tts/probe",
        payload: { modelId: "x-ai/grok-voice-tts-1.0", voice: "eve" },
      })
    ).json();

    expect(body.ok).toBe(true);
    expect(body.bytes).toBe(4);
    expect(body.contentType).toBe("audio/mpeg");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toMatchObject({
      model: "x-ai/grok-voice-tts-1.0",
      voice: "eve",
      response_format: "mp3",
    });
  });

  it("surfaces the provider's own rejection instead of throwing", async () => {
    // The real case this exists for: Gemini TTS accepts the model but not mp3.
    fetchMock.mockResolvedValue(
      new Response('{"error":{"message":"Gemini TTS only supports response_format=\\"pcm\\"."}}', { status: 400 }),
    );
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/tts/probe",
      payload: { modelId: "google/x", voice: "Kore" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, status: 400 });
    expect(res.json().error).toContain("pcm");
  });

  it("fails a 200 that is not mp3 — those bytes cannot reach Telegram", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03]), {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      }),
    );
    const app = await buildApp();

    const body = (await app.inject({ method: "POST", url: "/tts/probe", payload: { modelId: "m", voice: "" } })).json();

    expect(body.ok).toBe(false);
    expect(body.error).toContain("rather than mp3");
  });

  it("omits the voice field entirely for models that have none", async () => {
    fetchMock.mockResolvedValue(mp3Response());
    const app = await buildApp();

    await app.inject({ method: "POST", url: "/tts/probe", payload: { modelId: "fish-audio/s1", voice: "" } });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).not.toHaveProperty("voice");
  });

  it("reports a transport failure as data rather than a 500", async () => {
    fetchMock.mockRejectedValue(new Error("timed out"));
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/tts/probe", payload: { modelId: "m", voice: "" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, status: 0, error: "timed out" });
  });
});
