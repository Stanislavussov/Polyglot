import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { TranslationConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const configSchema = z.object({
  maxTranscriptionLength: z.number().int().min(1),
});

const DEFAULTS: TranslationConfig = {
  maxTranscriptionLength: 45,
};

export async function translationRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/translation", async () => {
    const value = await systemSettingsRepository.get<TranslationConfig>("translation");
    return value ?? DEFAULTS;
  });

  app.put("/translation", async (request: FastifyRequest) => {
    const body = configSchema.parse(request.body);
    await systemSettingsRepository.set("translation", body);
    return body;
  });
}
