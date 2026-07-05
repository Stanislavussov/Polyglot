import { systemSettingsRepository } from "@polyglot/adapter-db";
import { aiDefaultsSchema } from "@polyglot/admin-contracts";
import { type AIGenerationDefaults, FALLBACK_AI_DEFAULTS } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

export async function aiDefaultRoutes(app: FastifyInstance) {
  app.get("/ai-defaults", async () => {
    const value = await systemSettingsRepository.get<AIGenerationDefaults>("ai.defaults");
    return value ?? FALLBACK_AI_DEFAULTS;
  });

  app.put("/ai-defaults", async (request: FastifyRequest) => {
    const body = aiDefaultsSchema.parse(request.body);
    await systemSettingsRepository.set("ai.defaults", body);
    return body;
  });
}
