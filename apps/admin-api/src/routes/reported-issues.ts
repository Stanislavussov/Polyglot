import type { IssueStatus } from "@polyglot/adapter-db";
import { reportedIssueRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

const issueStatusSchema = z.enum(["open", "in_progress", "resolved", "rejected"]);

const listIssuesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: issueStatusSchema.optional(),
  search: z.string().max(200).optional(),
});

export async function reportedIssueRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

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
}
