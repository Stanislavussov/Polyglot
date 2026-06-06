import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { AIGenerationDefaults } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const defaultsSchema = z.object({
  maxTokens: z.number().int().min(1),
  temperature: z.number().min(0).max(2),
  frequencyPenalty: z.number().min(0).max(2),
  maxRetries: z.number().int().min(0).max(10),
});

const DEFAULTS: AIGenerationDefaults = {
  maxTokens: 4096,
  temperature: 0.3,
  frequencyPenalty: 0.5,
  maxRetries: 2,
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
