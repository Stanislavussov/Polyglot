import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { DictionaryConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const configSchema = z.object({
  flashcardLimit: z.number().int().min(1),
  notificationDictLimit: z.number().int().min(1),
  wordOfDayLimit: z.number().int().min(1),
});

const DEFAULTS: DictionaryConfig = {
  flashcardLimit: 10,
  notificationDictLimit: 1,
  wordOfDayLimit: 1,
};

export async function dictionaryRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/dictionary", async () => {
    const value = await systemSettingsRepository.get<DictionaryConfig>("dictionary");
    return value ?? DEFAULTS;
  });

  app.put("/dictionary", async (request: FastifyRequest) => {
    const body = configSchema.parse(request.body);
    await systemSettingsRepository.set("dictionary", body);
    return body;
  });
}
