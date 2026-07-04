import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { AIGenerationDefaults } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const defaultsSchema = z.object({
  maxTokens: z.number().int().min(1),
  temperature: z.number().min(0).max(2),
  frequencyPenalty: z.number().min(0).max(2),
  maxRetries: z.number().int().min(0).max(10),
  // Capped below the bot's 20 s loader guard so the adapter aborts first.
  requestTimeoutMs: z.number().int().min(1_000).max(20_000),
});

const DEFAULTS: AIGenerationDefaults = {
  maxTokens: 4096,
  temperature: 0.3,
  frequencyPenalty: 0.5,
  maxRetries: 2,
  requestTimeoutMs: 15_000,
};

export async function aiDefaultRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/ai-defaults", async () => {
    const value = await systemSettingsRepository.get<AIGenerationDefaults>("ai.defaults");
    return value ?? DEFAULTS;
  });

  app.put("/ai-defaults", async (request: FastifyRequest) => {
    const body = defaultsSchema.parse(request.body);
    await systemSettingsRepository.set("ai.defaults", body);
    return body;
  });
}
