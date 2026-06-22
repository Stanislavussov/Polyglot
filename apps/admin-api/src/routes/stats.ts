import {
  aiRequestLatencyRepository,
  getDb,
  languageDetectionRepository,
  requestTimingRepository,
  translationRequests,
  userRequestCountRepository,
  users,
} from "@polyglot/adapter-db";
import { gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

export async function statsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    await request.jwtVerify();
  });

  app.get("/stats", async () => {
    const db = getDb();

    const totalUsersResult = await db.select({ count: sql<number>`count(*)` }).from(users);
    const totalUsers = totalUsersResult[0]?.count ?? 0;

    const activeTodayResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    const activeToday = activeTodayResult[0]?.count ?? 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const translationsTodayResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(translationRequests)
      .where(gte(translationRequests.createdAt, todayStart));
    const translationsToday = translationsTodayResult[0]?.count ?? 0;

    const totalTranslationsResult = await db.select({ count: sql<number>`count(*)` }).from(translationRequests);
    const totalTranslations = totalTranslationsResult[0]?.count ?? 0;

    return {
      totalUsers,
      activeToday,
      translationsToday,
      totalTranslations,
    };
  });

  app.get("/stats/ai-latency", async () => {
    return aiRequestLatencyRepository.getModelLatencySummary();
  });

  app.get("/stats/request-timings", async (request) => {
    const query = request.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 7;
    const byDay = await requestTimingRepository.getSegmentSummaryByDay(days);
    const byModel = await requestTimingRepository.getSegmentSummaryByModel(days);
    return { byDay, byModel };
  });

  app.get("/stats/language-detection", async (request) => {
    const query = request.query as { days?: string };
    const days = query.days ? parseInt(query.days, 10) : 7;
    const byDay = await languageDetectionRepository.getSummaryByDay(days);
    const outcome = await languageDetectionRepository.getSummaryByOutcome(days);
    return { byDay, outcome };
  });

  app.get("/stats/user-request-counts", async (request) => {
    const querySchema = z.object({
      days: z.string().optional(),
    });
    const parsed = querySchema.parse(request.query);
    const rawDays = parsed.days ? Number.parseInt(parsed.days, 10) : 30;
    const days = Number.isNaN(rawDays) ? 30 : Math.max(1, Math.min(90, rawDays));

    const rows = await userRequestCountRepository.getUserRequestCountsByDay(days);

    const daysArray: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      daysArray.push(d.toISOString().slice(0, 10));
    }

    const userMap = new Map<
      number,
      {
        userId: number;
        username: string | null;
        telegramId: number;
        subscriptionPlan: string;
        counts: Record<string, number>;
        total: number;
      }
    >();

    for (const row of rows) {
      let user = userMap.get(row.userId);
      if (!user) {
        user = {
          userId: row.userId,
          username: row.username,
          telegramId: row.telegramId,
          subscriptionPlan: row.subscriptionPlan,
          counts: {},
          total: 0,
        };
        userMap.set(row.userId, user);
      }
      user.counts[row.day] = row.count;
      user.total += row.count;
    }

    const usersList = Array.from(userMap.values()).sort((a, b) => b.total - a.total);

    return {
      days: daysArray,
      users: usersList,
    };
  });
}
