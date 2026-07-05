import { systemSettingsRepository } from "@polyglot/adapter-db";
import { dictionarySettingsSchema } from "@polyglot/admin-contracts";
import { type DictionaryConfig, FALLBACK_DICTIONARY } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

export async function dictionaryRoutes(app: FastifyInstance) {
  app.get("/dictionary", async () => {
    const value = await systemSettingsRepository.get<DictionaryConfig>("dictionary");
    return value ?? FALLBACK_DICTIONARY;
  });

  app.put("/dictionary", async (request: FastifyRequest) => {
    const body = dictionarySettingsSchema.parse(request.body);
    await systemSettingsRepository.set("dictionary", body);
    return body;
  });
}
