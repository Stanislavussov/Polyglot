import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { SrsConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const configSchema = z.object({
  minEaseFactor: z.number().min(1).max(3),
  defaultEaseFactor: z.number().min(1).max(5),
});

const DEFAULTS: SrsConfig = {
  minEaseFactor: 1.3,
  defaultEaseFactor: 2.5,
};

export async function srsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/srs", async () => {
    const value = await systemSettingsRepository.get<SrsConfig>("srs");
    return value ?? DEFAULTS;
  });

  app.put("/srs", async (request: FastifyRequest) => {
    const body = configSchema.parse(request.body);
    await systemSettingsRepository.set("srs", body);
    return body;
  });
}
