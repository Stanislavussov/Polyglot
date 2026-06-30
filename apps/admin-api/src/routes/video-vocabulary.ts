import { systemSettingsRepository } from "@polyglot/adapter-db";
import type { VideoVocabularyConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const configSchema = z
  .object({
    monthlyLimit: z.number().int().min(1),
    minPhrases: z.number().int().min(1),
    maxPhrases: z.number().int().min(1),
    extractionModelId: z.string().min(1),
  })
  .refine((c) => c.maxPhrases >= c.minPhrases, {
    message: "maxPhrases must be greater than or equal to minPhrases",
    path: ["maxPhrases"],
  });

const DEFAULTS: VideoVocabularyConfig = {
  monthlyLimit: 3,
  minPhrases: 15,
  maxPhrases: 40,
  extractionModelId: "google/gemini-3.1-flash-lite",
};

export async function videoVocabularyRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/video-vocabulary", async () => {
    const value = await systemSettingsRepository.get<VideoVocabularyConfig>("videoVocabulary");
    return value ?? DEFAULTS;
  });

  app.put("/video-vocabulary", async (request: FastifyRequest) => {
    const body = configSchema.parse(request.body);
    await systemSettingsRepository.set("videoVocabulary", body);
    return body;
  });
}
