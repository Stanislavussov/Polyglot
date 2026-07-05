import { rateLimitPlanRepository } from "@polyglot/adapter-db";
import { rateLimitPlanSchema } from "@polyglot/admin-contracts";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../plugins/auth.js";
import { HttpError } from "../services/http-error.js";
import { registerCrudRoutes } from "./crud-factory.js";

export async function rateLimitRoutes(app: FastifyInstance) {
  // Auth is applied globally by the unified hook; mutating tariff plans is a
  // superadmin-only, destructive operation (Fable T07).
  const superadminOnly = requireRole("superadmin");

  registerCrudRoutes(app, {
    resource: "rate-limits",
    keyParam: "name",
    list: { handler: () => rateLimitPlanRepository.findAll() },
    upsert: {
      schema: rateLimitPlanSchema,
      preHandler: superadminOnly,
      handler: (body) => rateLimitPlanRepository.upsert(body),
    },
    remove: {
      preHandler: superadminOnly,
      // The default-plan guard lives in the repository transaction (it reassigns
      // affected users atomically); surface its failure as a clean 400 instead
      // of leaking a 500.
      handler: async (name) => {
        try {
          return await rateLimitPlanRepository.delete(name);
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : "Failed to delete plan");
        }
      },
      respond: (result, reply) => {
        const { fallbackPlan } = result as { fallbackPlan: string; reassignedUsers: number };
        if (!fallbackPlan) {
          return reply.status(404).send({ error: "Plan not found" });
        }
        return reply.status(200).send(result);
      },
    },
  });
}
