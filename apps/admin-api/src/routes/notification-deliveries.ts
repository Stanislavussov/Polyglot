import { NOTIFICATION_DELIVERY_KINDS, notificationDeliveryRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { paginationQuerySchema } from "./crud-factory.js";

const listDeliveriesQuerySchema = paginationQuerySchema().extend({
  // Capped at int4: a larger id would reach Postgres and fail as a 500 instead of a 400.
  userId: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  kind: z.enum(NOTIFICATION_DELIVERY_KINDS).optional(),
});

export async function notificationDeliveryRoutes(app: FastifyInstance) {
  app.get("/notification-deliveries", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listDeliveriesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query" });
    }

    const { page, limit, userId, kind } = parsed.data;
    const search = parsed.data.search?.trim();
    return notificationDeliveryRepository.list({
      page,
      limit,
      ...(userId !== undefined && { userId }),
      ...(kind && { kind }),
      ...(search && { search }),
    });
  });
}
