import { systemSettingsRepository } from "@polyglot/adapter-db";
import { videoVocabularySettingsSchema } from "@polyglot/admin-contracts";
import type { VideoVocabularyConfig } from "@polyglot/core";
import type { FastifyInstance, FastifyRequest } from "fastify";

const DEFAULTS: VideoVocabularyConfig = {
  monthlyLimit: 3,
  minPhrases: 15,
  maxPhrases: 40,
  extractionModelId: "google/gemini-3.1-flash-lite",
};

export async function videoVocabularyRoutes(app: FastifyInstance) {
  app.get("/video-vocabulary", async () => {
    const value = await systemSettingsRepository.get<VideoVocabularyConfig>("videoVocabulary");
    return value ?? DEFAULTS;
  });

  app.put("/video-vocabulary", async (request: FastifyRequest) => {
    const body = videoVocabularySettingsSchema.parse(request.body);
    await systemSettingsRepository.set("videoVocabulary", body);
    return body;
  });
}
