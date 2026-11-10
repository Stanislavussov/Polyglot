import { canReadReleaseNotes, findUnreleasedDir, logger, readNotesForReader } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import type { WebServices } from "../services.js";

/** The pending release notes in the reader's language — the queue the bot's /changes reads. */
export function changesRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/changes", async (request, reply) => {
    const user = request.learner;
    if (!canReadReleaseNotes(user.audienceGroup)) return reply.status(403).send({ code: "forbidden" });

    const notesDir = findUnreleasedDir();
    if (!notesDir) {
      logger.error("Release notes directory not found");
      return reply.status(503).send({ code: "unavailable" });
    }
    const settings = await services.userRepository.getSettings(user.id);
    const notes = readNotesForReader(notesDir, [settings?.interfaceLang, settings?.nativeLang]);
    return { notes: notes.map((note) => note.text) };
  });
}
