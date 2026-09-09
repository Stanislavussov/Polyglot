import {
  aiRequestLatencyRepository,
  dictionaryLookupLogRepository,
  languageDetectionRepository,
  requestTimingRepository,
  statsRepository,
  userRepository,
  userRequestCountRepository,
} from "@polyglot/adapter-db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const daysQuerySchema = z.object({
  // Non-numeric `days` is rejected (400); out-of-range values are clamped to 1..90.
  days: z.coerce
    .number()
    .int()
    .transform((n) => Math.min(90, Math.max(1, n)))
    .default(7),
});

export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats", async () => {
    return statsRepository.getOverview();
  });

  app.get("/stats/ai-latency", async () => {
    return aiRequestLatencyRepository.getModelLatencySummary();
  });

  app.get("/stats/request-timings", async (request) => {
    const { days } = daysQuerySchema.parse(request.query);
    const byDay = await requestTimingRepository.getSegmentSummaryByDay(days);
    const byModel = await requestTimingRepository.getSegmentSummaryByModel(days);
    return { byDay, byModel };
  });

  app.get("/stats/language-detection", async (request) => {
    const { days } = daysQuerySchema.parse(request.query);
    const byDay = await languageDetectionRepository.getSummaryByDay(days);
    const outcome = await languageDetectionRepository.getSummaryByOutcome(days);
    return { byDay, outcome };
  });

  // Onboarding funnel (Task 72): users by furthest step reached, split by completion.
  app.get("/stats/onboarding-funnel", async () => userRepository.getOnboardingFunnel());

  app.get("/stats/dictionary-lookups", async (request) => {
    const querySchema = z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      days: z.string().optional(),
    });
    const parsed = querySchema.parse(request.query);
    const rawPage = parsed.page ? Number.parseInt(parsed.page, 10) : 1;
    const rawLimit = parsed.limit ? Number.parseInt(parsed.limit, 10) : 50;
    const rawDays = parsed.days ? Number.parseInt(parsed.days, 10) : 7;
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage);
    const limit = Number.isNaN(rawLimit) ? 50 : Math.max(1, Math.min(200, rawLimit));
    const days = Number.isNaN(rawDays) ? 7 : Math.max(1, Math.min(90, rawDays));

    const [logPage, summary] = await Promise.all([
      dictionaryLookupLogRepository.listRecent(page, limit),
      dictionaryLookupLogRepository.getSummary(days),
    ]);

    return {
      ...logPage,
      summary,
    };
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
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - i);
      daysArray.push(d.toISOString().slice(0, 10));
    }
    const visibleDays = new Set(daysArray);

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
      if (!visibleDays.has(row.day)) {
        continue;
      }
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
