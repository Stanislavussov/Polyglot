import type { IssueStatus } from "@polyglot/adapter-db";
import { reportedIssueRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const issueStatusSchema = z.enum(["open", "in_progress", "resolved", "rejected"]);

const listIssuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: issueStatusSchema.optional(),
  search: z.string().max(200).optional(),
});

const updateIssueParamsSchema = z.object({
  id: z.coerce.number().int().min(1),
});

const updateIssueBodySchema = z.object({
  status: issueStatusSchema,
});

export async function reportedIssueRoutes(app: FastifyInstance) {
  app.get("/reported-issues", async (request: FastifyRequest) => {
    const query = listIssuesQuerySchema.parse(request.query);
    const filters: {
      page: number;
      limit: number;
      status?: IssueStatus;
      search?: string;
    } = {
      page: query.page,
      limit: query.limit,
    };

    if (query.status) {
      filters.status = query.status;
    }

    const search = query.search?.trim();
    if (search) {
      filters.search = search;
    }

    return reportedIssueRepository.list(filters);
  });

  app.put("/reported-issues/:id/status", async (request: FastifyRequest, reply: FastifyReply) => {
    const paramsResult = updateIssueParamsSchema.safeParse(request.params);
    const bodyResult = updateIssueBodySchema.safeParse(request.body);

    if (!paramsResult.success || !bodyResult.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }

    const updated = await reportedIssueRepository.updateStatus(paramsResult.data.id, bodyResult.data.status);

    if (!updated) {
      return reply.status(404).send({ error: "Issue not found" });
    }

    return updated;
  });
}
