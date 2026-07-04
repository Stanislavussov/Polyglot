import { rateLimitPlanRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole } from "../plugins/auth.js";

const planSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  creditsPerDay: z.number().int().min(0).nullable(),
  windowMs: z.number().int().min(1).default(86_400_000),
  creditCost: z.number().int().min(1).default(1),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export async function rateLimitRoutes(app: FastifyInstance) {
  // Auth is applied globally by the unified hook; mutating tariff plans is a
  // superadmin-only, destructive operation (Fable T07).
  const superadminOnly = { preHandler: requireRole("superadmin") };

  app.get("/rate-limits", async () => {
    const plans = await rateLimitPlanRepository.findAll();
    return plans;
  });

  app.put("/rate-limits", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = planSchema.parse(request.body);
    const plan = await rateLimitPlanRepository.upsert(body);
    return reply.status(200).send(plan);
  });

  app.delete("/rate-limits/:name", superadminOnly, async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    try {
      const result = await rateLimitPlanRepository.delete(name);
      if (!result.fallbackPlan) {
        return reply.status(404).send({ error: "Plan not found" });
      }
      return reply.status(200).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete plan";
      return reply.status(400).send({ error: message });
    }
  });
}
