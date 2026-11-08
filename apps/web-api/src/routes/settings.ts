import { getSupportedLangs, isSupported, MAX_LEARNING_LANGS } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

const settingsPatchSchema = z
  .object({
    interfaceLang: z.string().optional(),
    nativeLang: z.string().optional(),
    learningLangs: z.array(z.string()).min(1).max(MAX_LEARNING_LANGS).optional(),
  })
  .strict();

async function readSettings(services: WebServices, userId: number) {
  const settings = await services.userRepository.getSettings(userId);
  const cache = services.languageCache;
  const display = settings?.interfaceLang ?? "en";
  return {
    interfaceLang: display,
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    interfaceLanguages: getSupportedLangs(),
    languages: cache.getSupportedLangs().map((lang) => ({
      code: lang.code,
      name: cache.getLangName(lang.code, display),
      flag: lang.flag ?? "",
    })),
  };
}

export function settingsRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/settings", async (request) => readSettings(services, request.learner.id));

  // Writes go through the same repository the bot's settings scene uses, so the
  // bot reads the change on its next `getSettings(userId)`.
  app.patch("/api/settings", async (request, reply) => {
    const parsed = settingsPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_settings" });
    const patch = parsed.data;
    const known = (code: string) => services.languageCache.getLang(code)?.isSupported === true;

    if (patch.interfaceLang !== undefined && !isSupported(patch.interfaceLang)) {
      return reply.status(400).send({ code: "invalid_settings" });
    }
    if (patch.nativeLang !== undefined && !known(patch.nativeLang)) {
      return reply.status(400).send({ code: "invalid_settings" });
    }
    const current = await services.userRepository.getSettings(request.learner.id);
    const nativeLang = patch.nativeLang ?? current?.nativeLang;
    const learningLangs = patch.learningLangs ? [...new Set(patch.learningLangs)] : undefined;
    if (learningLangs && (!learningLangs.every(known) || learningLangs.includes(nativeLang ?? ""))) {
      return reply.status(400).send({ code: "invalid_settings" });
    }

    const userId = request.learner.id;
    if (patch.interfaceLang !== undefined)
      await services.userRepository.updateInterfaceLang(userId, patch.interfaceLang);
    if (patch.nativeLang !== undefined) await services.userRepository.updateNativeLang(userId, patch.nativeLang);
    if (learningLangs) await services.userRepository.updateLearningLangs(userId, learningLangs);
    return readSettings(services, userId);
  });
}
