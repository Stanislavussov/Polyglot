/**
 * Mentor-chat settings — read, write, and browse available chat models.
 *
 * The model picker is fed by OpenRouter's full catalogue filtered to text-out
 * models (mentor is plain chat), so the admin picks from a live list instead of
 * typing a slug that may not exist. An empty modelId is valid: it means "answer
 * with the regular default-model chain", never "feature off".
 */
import { systemSettingsRepository } from "@polyglot/adapter-db";
import { mentorSettingsSchema } from "@polyglot/admin-contracts";
import { FALLBACK_MENTOR, type MentorConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const SETTINGS_KEY = "mentor";
const OPENROUTER_FETCH_TIMEOUT_MS = 10_000;

const chatModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
      architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
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

export async function mentorRoutes(app: FastifyInstance) {
  app.get("/mentor", async () => {
    const value = await systemSettingsRepository.get<MentorConfig>(SETTINGS_KEY);
    // Fall back to the SHARED default rather than a copy declared here — a
    // route-local default is how the admin panel and the runtime drift apart.
    return { ...FALLBACK_MENTOR, ...(value ?? {}) };
  });

  app.put("/mentor", async (request: FastifyRequest) => {
    const body = mentorSettingsSchema.parse(request.body);
    await systemSettingsRepository.set(SETTINGS_KEY, body);
    return body;
  });

  /** Chat models available on OpenRouter (text output only, no variants like :free). */
  app.get("/mentor/models", async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: openRouterHeaders(),
      signal: AbortSignal.timeout(OPENROUTER_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status} ${response.statusText}`);
    }

    const body = chatModelsResponseSchema.parse(await response.json());
    return body.data
      .filter((model) => {
        const out = model.architecture?.output_modalities;
        // No declared modalities → assume plain text; anything declaring text qualifies.
        if (out !== undefined && !out.includes("text")) return false;
        // Routing/pricing variants (":free" rate-limits, ":batch" is async-only)
        // are traps for an interactive chat — hide them from the picker.
        return !model.id.includes(":");
      })
      .map((model) => ({
        id: model.id,
        name: model.name,
        // USD per token, as OpenRouter prices completion models — kept raw so the
        // admin panel can format its own per-1M unit.
        pricing: { prompt: model.pricing?.prompt ?? "0", completion: model.pricing?.completion ?? "0" },
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
