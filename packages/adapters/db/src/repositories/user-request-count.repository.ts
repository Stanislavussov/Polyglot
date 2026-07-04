import { desc, eq, gte } from "drizzle-orm";
import { getDb } from "../connection.js";
import { userDailyRequestCounts, users } from "../schema.js";

export interface UserRequestCountRow {
  userId: number;
  username: string | null;
  telegramId: number;
  subscriptionPlan: string;
  day: string;
  count: number;
}

export const userRequestCountRepository = {
  /**
   * Per-user/per-day request counts for the admin dashboard.
   *
   * Reads the pre-aggregated `user_daily_request_counts` counter (Fable T25/E5)
   * rather than running a `GROUP BY to_char(created_at)` over the unboundedly
   * growing `translation_requests` ledger. The counter is bumped on every logged
   * request and retention-pruned, so this reader never scans an ever-growing
   * table. Day buckets are UTC calendar days, so the result is independent of the
   * container/process timezone.
   */
  async getUserRequestCountsByDay(days = 30): Promise<UserRequestCountRow[]> {
    const db = getDb();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    const sinceDay = since.toISOString().slice(0, 10);

    const rows = await db
      .select({
        userId: userDailyRequestCounts.userId,
        username: users.username,
        telegramId: users.telegramId,
        subscriptionPlan: users.subscriptionPlan,
        day: userDailyRequestCounts.day,
        count: userDailyRequestCounts.requestCount,
      })
      .from(userDailyRequestCounts)
      .innerJoin(users, eq(userDailyRequestCounts.userId, users.id))
      .where(gte(userDailyRequestCounts.day, sinceDay))
      .orderBy(desc(userDailyRequestCounts.requestCount), desc(userDailyRequestCounts.day));

    return rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      telegramId: row.telegramId,
      subscriptionPlan: row.subscriptionPlan,
      day: row.day,
      count: row.count,
    }));
  },
};
