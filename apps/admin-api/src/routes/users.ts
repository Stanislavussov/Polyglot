import {
  AUDIENCE_GROUPS,
  getDb,
  rateLimitPlanRepository,
  userLanguageSettings,
  userRepository,
  users,
} from "@polyglot/adapter-db";
import { eq, ilike, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole } from "../plugins/auth.js";

const listUsersQuerySchema = z.object({
  // Non-numeric input is rejected (400 via the global handler); out-of-range
  // values are clamped so `?limit=100000` can never dump the whole table.
  page: z.coerce
    .number()
    .int()
    .transform((n) => Math.max(1, n))
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .transform((n) => Math.min(100, Math.max(1, n)))
    .default(20),
  search: z.string().max(200).optional(),
});

const updatePlanSchema = z.object({
  plan: z.string().min(1).max(50),
});

const updateAudienceGroupSchema = z.object({
  audienceGroup: z.enum(AUDIENCE_GROUPS),
});

export async function userRoutes(app: FastifyInstance) {
  // Auth is applied globally by the unified hook; changing a user's plan or
  // audience group is a superadmin-only operation (Fable T07).
  const superadminOnly = { preHandler: requireRole("superadmin") };

  app.get("/users", async (request: FastifyRequest) => {
    const { page, limit, search } = listUsersQuerySchema.parse(request.query);
    const offset = (page - 1) * limit;

    const db = getDb();

    // Same filter drives both the page selection and the total count, so
    // pagination stays consistent when a search term is applied.
    const searchFilter = search ? ilike(users.username, `%${search}%`) : undefined;

    const usersList = await db
      .select({
        id: users.id,
        telegramId: users.telegramId,
        username: users.username,
        audienceGroup: users.audienceGroup,
        subscriptionPlan: users.subscriptionPlan,
        isActive: users.isActive,
        createdAt: users.createdAt,
        interfaceLang: userLanguageSettings.interfaceLang,
        nativeLang: userLanguageSettings.nativeLang,
        learningLangs: userLanguageSettings.learningLangs,
      })
      .from(users)
      .leftJoin(userLanguageSettings, eq(users.id, userLanguageSettings.userId))
      .where(searchFilter)
      .limit(limit)
      .offset(offset);

    const countResult = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(searchFilter);

    const total = countResult[0]?.count ?? 0;

    return { users: usersList, total, page, limit };
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

    const db = getDb();
    const updated = await db.update(users).set({ subscriptionPlan: body.plan }).where(eq(users.id, userId)).returning({
      id: users.id,
    });

    if (updated.length === 0) {
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
