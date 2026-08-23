/**
 * STT settings — read, write, and browse available transcription models.
 *
 * No probe route: unlike TTS's format ambiguity, OpenRouter's
 * `/audio/transcriptions` accepts Telegram's OGG/Opus voice format directly
 * (verified against the live API 2026-08-23), so there is nothing here that a
 * probe would catch before shipping.
 */
import { systemSettingsRepository } from "@polyglot/adapter-db";
import { sttSettingsSchema } from "@polyglot/admin-contracts";
import { FALLBACK_STT, type SttConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const SETTINGS_KEY = "stt";
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;

const transcriptionModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
    }),
  ),
});

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.OPENROUTER_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }
  return headers;
}

export async function sttRoutes(app: FastifyInstance) {
  app.get("/stt", async () => {
    const value = await systemSettingsRepository.get<SttConfig>(SETTINGS_KEY);
    // Fall back to the SHARED default rather than a copy declared here — a
    // route-local default is how the admin panel and the runtime drift apart.
    return { ...FALLBACK_STT, ...(value ?? {}) };
  });

  app.put("/stt", async (request: FastifyRequest) => {
    const body = sttSettingsSchema.parse(request.body);
    await systemSettingsRepository.set(SETTINGS_KEY, body);
    return body;
  });

  /**
   * Transcription models available on OpenRouter, so the admin picks from a
   * live list instead of typing a slug that may not exist.
   */
  app.get("/stt/models", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models?output_modalities=transcription", {
      headers: openRouterHeaders(),
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter transcription models request failed: ${response.status} ${response.statusText}`);
    }

    const body = transcriptionModelsResponseSchema.parse(await response.json());
    return body.data
      .map((model) => ({
        id: model.id,
        name: model.name,
        // USD per second of audio, as OpenRouter prices transcription — kept raw
        // (not pre-multiplied) so the admin panel can format it per its own unit.
        pricing: { prompt: model.pricing?.prompt ?? "0" },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
