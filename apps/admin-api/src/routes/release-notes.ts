import { releaseAnnouncementJobRepository } from "@polyglot/adapter-db";
import { releaseNoteSendSchema, zodErrorMessage } from "@polyglot/admin-contracts";
import { findReleasesDir, findUnreleasedDir, readRequiredLanguages, readTranslatedNotes } from "@polyglot/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireRole } from "../plugins/auth.js";

/**
 * Who a release note reaches. Not a form field: widening it beyond the people
 * who agreed to be an audience is a product decision, not a per-send choice.
 */
const RELEASE_AUDIENCE_GROUPS = ["admin", "tester"];

export async function releaseNoteRoutes(app: FastifyInstance) {
  // Announcing to real chats is a superadmin action, like changing a plan.
  const superadminOnly = { preHandler: requireRole("superadmin") };

  app.get("/release-notes", async () => {
    const unreleasedDir = findUnreleasedDir();
    const releasesDir = findReleasesDir();
    return {
      notes: unreleasedDir ? readTranslatedNotes(unreleasedDir) : [],
      languages: releasesDir ? readRequiredLanguages(releasesDir) : ["en"],
      jobs: await releaseAnnouncementJobRepository.list(20),
    };
  });

  app.post("/release-notes/send", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = releaseNoteSendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: zodErrorMessage(parsed.error) });
    }

    const job = await releaseAnnouncementJobRepository.enqueue({
      notes: parsed.data.notes,
      audienceGroups: RELEASE_AUDIENCE_GROUPS,
      createdBy: request.adminUser?.email ?? null,
    });

    // 202: the bot does the sending, and it has not happened yet.
    return reply.status(202).send({ jobId: job.id });
  });
}
