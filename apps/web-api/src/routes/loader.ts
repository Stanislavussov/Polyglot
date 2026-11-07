import {
  hasWaitPhrases,
  isSupported,
  type LoaderKind,
  loaderEmoji,
  loaderPhraseKeys,
  t,
  waitPhrases,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import type { WebServices } from "../services.js";

// Matches the bot loader's six phrase stages (one shown, five ticks).
const STAGE_COUNT = 6;
const KINDS: readonly LoaderKind[] = ["translate", "mentor"];

export function loaderRoutes(app: FastifyInstance, services: WebServices): void {
  // The web app may not import core runtime code, so it gets the bot's wait phrases from here.
  app.get<{ Params: { kind: string } }>("/api/loader/:kind", async (request, reply) => {
    const kind = KINDS.find((candidate) => candidate === request.params.kind);
    if (!kind) return reply.status(404).send({ code: "not_found" });

    const settings = await services.userRepository.getSettings(request.learner.id);
    const interfaceLang = settings?.interfaceLang ?? "en";
    const lang = isSupported(interfaceLang) ? interfaceLang : "en";
    const covered = (settings?.learningLangs ?? []).filter(hasWaitPhrases);

    const stages = Array.from({ length: STAGE_COUNT }, (_, stage) =>
      covered.length > 0
        ? covered.flatMap((code) => waitPhrases(code, stage))
        : loaderPhraseKeys(kind, stage).map((key) => t(key, lang)),
    );
    return { emoji: covered.length > 0 ? [...loaderEmoji(kind)] : [], stages };
  });
}
