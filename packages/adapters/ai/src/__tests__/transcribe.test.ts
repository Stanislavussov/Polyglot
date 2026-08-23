import { AITimeoutError } from "@polyglot/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetClient, setAIApiKey } from "../client.js";
import { setAIRequestMetricSink } from "../logger.js";
import { setAIRequestTimeoutProvider } from "../timeout.js";
import { transcribeAudio } from "../transcribe.js";

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

describe("transcribeAudio", () => {
  const audio = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    setAIApiKey("test-key");
    setAIRequestMetricSink(null);
    setAIRequestTimeoutProvider(null);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    resetClient();
    setAIRequestTimeoutProvider(null);
    vi.unstubAllGlobals();
  });

  it("posts the exact URL, headers, and base64-encoded body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { text: "hello", usage: { seconds: 1.5, cost: 0.001 } },
        { headers: { "X-Generation-Id": "gen-1" } },
      ),
    );

    await transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      model: "openai/whisper-1",
      input_audio: {
        data: Buffer.from(audio).toString("base64"),
        format: "ogg",
      },
    });
  });

  it("passes the language hint through and omits the field when unset", async () => {
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ text: "привет" }));

    await transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1", language: "ru" });
    const withHint = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(withHint.language).toBe("ru");

    await transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" });
    const withoutHint = JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string);
    expect("language" in withoutHint).toBe(false);
  });

  it("returns trimmed text plus seconds, cost, and generation id on success", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { text: "  hello world  ", usage: { seconds: 3.168, cost: 0.0000105 } },
        { headers: { "X-Generation-Id": "gen-stt-123" } },
      ),
    );

    const result = await transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" });

    expect(result).toEqual({
      text: "hello world",
      seconds: 3.168,
      costUsd: 0.0000105,
      generationId: "gen-stt-123",
    });
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("bad request", { status: 400, statusText: "Bad Request" }));

    await expect(transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" })).rejects.toThrow(/400/);
  });

  it("raises AITimeoutError when the request budget elapses", async () => {
    setAIRequestTimeoutProvider(() => 10);
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal;
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });

    await expect(transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" })).rejects.toBeInstanceOf(
      AITimeoutError,
    );
  });

  it("returns null seconds/cost when usage fields are missing", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ text: "hello" }));

    const result = await transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" });

    expect(result.seconds).toBeNull();
    expect(result.costUsd).toBeNull();
  });

  it("returns an empty string for whitespace-only text", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ text: "   " }));

    const result = await transcribeAudio({ audio, format: "ogg", modelId: "openai/whisper-1" });

    expect(result.text).toBe("");
  });
});
