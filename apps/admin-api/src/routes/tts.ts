/**
 * TTS settings — read, write, browse available speech models, and probe one.
 *
 * The probe exists because the models API cannot tell you the thing that matters
 * most here: whether a model can return mp3. Telegram `sendVoice` takes mp3
 * directly, which is what keeps ffmpeg out of the bot image, and at least one
 * otherwise-ideal model (Gemini 3.1 Flash TTS, 70+ languages) rejects it outright
 * at request time. Without a probe an admin can only discover that by shipping it.
 */
import { systemSettingsRepository } from "@polyglot/adapter-db";
import { ttsSettingsSchema } from "@polyglot/admin-contracts";
import { FALLBACK_TTS, type TtsConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const SETTINGS_KEY = "tts";
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 45_000;

/** Word used to probe a model. Short on purpose — the probe should cost nothing. */
const PROBE_TEXT = "test";

const speechModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
      supported_voices: z.array(z.string()).nullish(),
    }),
  ),
});

const probeRequestSchema = z.object({
  modelId: z.string().min(1),
  voice: z.string(),
});

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }
  return headers;
}

export async function ttsRoutes(app: FastifyInstance) {
  app.get("/tts", async () => {
    const value = await systemSettingsRepository.get<TtsConfig>(SETTINGS_KEY);
    // Fall back to the SHARED default rather than a copy declared here — a
    // route-local default is how the admin panel and the runtime drift apart.
    return { ...FALLBACK_TTS, ...(value ?? {}) };
  });

  app.put("/tts", async (request: FastifyRequest) => {
    const body = ttsSettingsSchema.parse(request.body);
    await systemSettingsRepository.set(SETTINGS_KEY, body);
    return body;
  });

  /**
   * Speech models available on OpenRouter, with their voices — so the admin picks
   * from a live list instead of typing a slug that may not exist.
   */
  app.get("/tts/models", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=speech", {
      headers: openRouterHeaders(),
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter speech models request failed: ${response.status} ${response.statusText}`);
    }

    const body = speechModelsResponseSchema.parse(await response.json());
    return body.data
      .map((model) => ({
        id: model.id,
        name: model.name,
        voices: model.supported_voices ?? [],
        pricePerMillionChars: Number(model.pricing?.prompt ?? 0) * 1_000_000,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /**
   * Synthesize one short word with the given model/voice and report what came
   * back. Never throws on a provider rejection — the provider's own message is the
   * useful part, so it is returned as data for the admin to read.
   */
  app.post("/tts/probe", async (request: FastifyRequest) => {
    const { modelId, voice } = probeRequestSchema.parse(request.body);
    const startedAt = Date.now();

    try {
      const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: { ...openRouterHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          input: PROBE_TEXT,
          response_format: "mp3",
          ...(voice ? { voice } : {}),
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        return {
          ok: false as const,
          durationMs,
          status: response.status,
          error: (await response.text().catch(() => "")).slice(0, 500),
        };
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "";
      // A 200 carrying something other than mp3 is still a failure for our
      // purposes: those bytes cannot go to Telegram without a transcode.
      const isMp3 = contentType.includes("mpeg") || (bytes[0] === 0x49 && bytes[1] === 0x44) || bytes[0] === 0xff;

      return {
        ok: isMp3 && bytes.byteLength > 0,
        durationMs,
        status: response.status,
        bytes: bytes.byteLength,
        contentType,
        ...(isMp3 ? {} : { error: `Model returned ${contentType || "an unknown format"} rather than mp3` }),
      };
    } catch (err) {
      return {
        ok: false as const,
        durationMs: Date.now() - startedAt,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
