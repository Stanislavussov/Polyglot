import { gte, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { translationRequests, userLanguageSettings, users } from "../schema.js";

export interface AdminOverviewStats {
  totalUsers: number;
  activeToday: number;
  translationsToday: number;
  totalTranslations: number;
}

export const statsRepository = {
  /** Dashboard overview counters for the admin panel (Fable T27, de-Drizzled from the route). */
  async getOverview(): Promise<AdminOverviewStats> {
    const db = getDb();

    const totalUsersResult = await db.select({ count: sql<number>`count(*)` }).from(users);
    const totalUsers = totalUsersResult[0]?.count ?? 0;

    // "Active today" = users who interacted in the last 24h, tracked on
    // user_language_settings.last_interaction_at — not registration date.
    const activeTodayResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userLanguageSettings)
      .where(gte(userLanguageSettings.lastInteractionAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
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

    return { totalUsers, activeToday, translationsToday, totalTranslations };
  },
};
