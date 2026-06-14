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

const updatePlanSchema = z.object({
  plan: z.string().min(1).max(50),
});

const updateAudienceGroupSchema = z.object({
  audienceGroup: z.enum(AUDIENCE_GROUPS),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/users", async (request: FastifyRequest) => {
    const {
      page = "1",
      limit = "20",
      search = "",
    } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const pageNum = Number.parseInt(page, 10);
    const limitNum = Number.parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const db = getDb();

    let query = db
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
      .limit(limitNum)
      .offset(offset);

    if (search) {
      const searchPattern = `%${search}%`;
      query = query.where(ilike(users.username, searchPattern)) as typeof query;
    }

    const usersList = await query;

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(users);

    const total = countResult[0]?.count ?? 0;

    return { users: usersList, total, page: pageNum, limit: limitNum };
  });

  app.put("/users/:id/plan", async (request: FastifyRequest, reply: FastifyReply) => {
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

  app.put("/users/:id/audience-group", async (request: FastifyRequest, reply: FastifyReply) => {
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
