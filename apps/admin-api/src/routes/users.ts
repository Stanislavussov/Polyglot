import { rateLimitPlanRepository, userRepository } from "@polyglot/adapter-db";
import { audienceGroupSchema, subscriptionPlanSchema } from "@polyglot/admin-contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole } from "../plugins/auth.js";
import { paginationQuerySchema } from "./crud-factory.js";

const listUsersQuerySchema = paginationQuerySchema();
const updatePlanSchema = z.object({ plan: subscriptionPlanSchema });
const updateAudienceGroupSchema = z.object({ audienceGroup: audienceGroupSchema });

export async function userRoutes(app: FastifyInstance) {
  // Auth is applied globally by the unified hook; changing a user's plan or
  // audience group is a superadmin-only operation (Fable T07).
  const superadminOnly = { preHandler: requireRole("superadmin") };

  app.get("/users", async (request: FastifyRequest) => {
    const { page, limit, search } = listUsersQuerySchema.parse(request.query);
    const { users, total } = await userRepository.listAdmin({ page, limit, search });
    return { users, total, page, limit };
  });

  app.put("/users/:id/plan", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = updatePlanSchema.parse(request.body);
    const plan = await rateLimitPlanRepository.findByName(body.plan);
    if (!plan?.isActive) {
      return reply.status(400).send({ error: "Plan is not available" });
    }

    const userId = Number.parseInt(id, 10);
    if (!Number.isInteger(userId)) {
      return reply.status(400).send({ error: "Invalid user id" });
    }

    const updated = await userRepository.updateSubscriptionPlan(userId, body.plan);
    if (!updated) {
      return reply.status(404).send({ error: "User not found" });
    }

    return { success: true };
  });

  app.put("/users/:id/audience-group", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = updateAudienceGroupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid audience group" });
    }

    const userId = Number.parseInt(id, 10);
    if (!Number.isInteger(userId)) {
      return reply.status(400).send({ error: "Invalid user id" });
    }

    const updated = await userRepository.updateAudienceGroup(userId, parsed.data.audienceGroup);

    if (!updated) {
      return reply.status(404).send({ error: "User not found" });
    }

    return { success: true };
  });
}
