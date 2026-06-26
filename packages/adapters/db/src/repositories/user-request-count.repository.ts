import { desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { translationRequests, users } from "../schema.js";

export interface UserRequestCountRow {
  userId: number;
  username: string | null;
  telegramId: number;
  subscriptionPlan: string;
  day: string;
  count: number;
}

export const userRequestCountRepository = {
  async getUserRequestCountsByDay(days = 30): Promise<UserRequestCountRow[]> {
    const db = getDb();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    const rows = await db
      .select({
        userId: translationRequests.userId,
        username: users.username,
        telegramId: users.telegramId,
        subscriptionPlan: users.subscriptionPlan,
        day: sql<string>`to_char(${translationRequests.createdAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(translationRequests)
      .innerJoin(users, eq(translationRequests.userId, users.id))
      .where(gte(translationRequests.createdAt, since))
      .groupBy(
        translationRequests.userId,
        users.username,
        users.telegramId,
        users.subscriptionPlan,
        sql`to_char(${translationRequests.createdAt}, 'YYYY-MM-DD')`,
      )
      .orderBy(desc(sql`count(*)`), desc(sql`to_char(${translationRequests.createdAt}, 'YYYY-MM-DD')`));

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
