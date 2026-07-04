import { systemSettingsRepository } from "@polyglot/adapter-db";
import { srsSettingsSchema } from "@polyglot/admin-contracts";
import { FALLBACK_SRS, type SrsConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

export async function srsRoutes(app: FastifyInstance) {
  app.get("/srs", async () => {
    const value = await systemSettingsRepository.get<SrsConfig>("srs");
    return value ?? FALLBACK_SRS;
  });

  app.put("/srs", async (request: FastifyRequest) => {
    const body = srsSettingsSchema.parse(request.body);
    await systemSettingsRepository.set("srs", body);
    return body;
  });
}
