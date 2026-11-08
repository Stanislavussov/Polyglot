import { logger } from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";

/** The bot's report dialog limit (`MAX_DESCRIPTION_LENGTH`), so both channels accept the same reports. */
const MAX_DESCRIPTION_LENGTH = 1000;

const bodySchema = z
  .object({
    type: z.enum(["bug", "suggestion", "other"]),
    description: z.string().trim().min(1).max(MAX_DESCRIPTION_LENGTH),
  })
  .strict();

// Lands in the same table as the bot's /report-issue, where the admin panel reads it.
export function reportRoutes(app: FastifyInstance, services: WebServices): void {
  app.post("/api/report", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_report" });
    const userId = request.learner.id;
    await services.reportedIssueRepository.create(userId, parsed.data.type, parsed.data.description);
    logger.info({ userId, type: parsed.data.type, channel: "web" }, "User submitted a report");
    return reply.status(204).send();
  });
}
