import { onboardingDemoCardRepository } from "@polyglot/adapter-db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

/**
 * Review surface for the onboarding hook-card cache.
 *
 * A generated card is cached inactive on purpose — these are the first thing a
 * brand-new user sees, so a human approves each one. Without this surface there
 * is no way to approve anything, and the whole cache stays unservable: every
 * hook tap falls through to a live (slow, paid) translation.
 */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sourceLang: z.string().min(1).max(16).optional(),
  nativeLang: z.string().min(1).max(16).optional(),
  // Query strings carry no booleans; "" means "no filter" so the UI can send an
  // unset select without stripping the parameter.
  isActive: z.enum(["true", "false", ""]).optional(),
  search: z.string().max(200).optional(),
});

const setActiveBodySchema = z.object({
  sourceLang: z.string().min(1).max(16),
  nativeLang: z.string().min(1).max(16),
  headword: z.string().min(1).max(200),
  isActive: z.boolean(),
});

export async function onboardingDemoCardRoutes(app: FastifyInstance) {
  app.get("/onboarding-demo-cards", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }

    const query = parsed.data;
    const filters: Parameters<typeof onboardingDemoCardRepository.list>[0] = {
      page: query.page,
      limit: query.limit,
    };

    if (query.sourceLang) filters.sourceLang = query.sourceLang;
    if (query.nativeLang) filters.nativeLang = query.nativeLang;
    if (query.isActive === "true" || query.isActive === "false") {
      filters.isActive = query.isActive === "true";
    }

    const search = query.search?.trim();
    if (search) filters.search = search;

    return onboardingDemoCardRepository.list(filters);
  });

  // Keyed by the natural key rather than the row id: the reviewer approves a
  // (learning language, native language, headword) triple, which is exactly what
  // the bot looks up, and that is the key the warm-up script writes.
  app.put("/onboarding-demo-cards/active", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = setActiveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request" });
    }

    const { sourceLang, nativeLang, headword, isActive } = parsed.data;
    const updated = await onboardingDemoCardRepository.setActive(sourceLang, nativeLang, headword, isActive);

    if (!updated) {
      return reply.status(404).send({ error: "Demo card not found" });
    }

    return { sourceLang, nativeLang, headword, isActive };
  });
}
