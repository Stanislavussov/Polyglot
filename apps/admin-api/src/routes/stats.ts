import {
  aiRequestLatencyRepository,
  getDb,
  languageDetectionRepository,
  requestTimingRepository,
  translationRequests,
  users,
} from "@polyglot/adapter-db";
import { gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

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
}
