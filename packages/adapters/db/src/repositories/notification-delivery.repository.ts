import type { SQL } from "drizzle-orm";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import { type NotificationDeliveryKind, notificationDeliveries, users } from "../schema.js";

export interface RecordNotificationDeliveryInput {
  userId: number;
  kind: NotificationDeliveryKind;
  text: string;
  parseMode?: "HTML" | null;
  meta?: Record<string, string | number | null>;
}

export interface NotificationDeliveryListFilters {
  page: number;
  limit: number;
  userId?: number;
  kind?: NotificationDeliveryKind;
  search?: string;
}

export interface NotificationDeliveryListItem {
  id: number;
  userId: number;
  kind: NotificationDeliveryKind;
  text: string;
  parseMode: string | null;
  meta: Record<string, string | number | null> | null;
  sentAt: Date;
  user: {
    id: number;
    telegramId: number;
    username: string | null;
  };
}

export interface NotificationDeliveryListResult {
  deliveries: NotificationDeliveryListItem[];
  total: number;
  page: number;
  limit: number;
}

function buildListWhere(filters: NotificationDeliveryListFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.userId !== undefined) {
    conditions.push(eq(notificationDeliveries.userId, filters.userId));
  }
  if (filters.kind) {
    conditions.push(eq(notificationDeliveries.kind, filters.kind));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    const searchCondition = or(
      ilike(notificationDeliveries.text, pattern),
      ilike(users.username, pattern),
      sql`${users.telegramId}::text ilike ${pattern}`,
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export const notificationDeliveryRepository = {
  async record(input: RecordNotificationDeliveryInput): Promise<void> {
    const db = getDb();
    await db.insert(notificationDeliveries).values({
      userId: input.userId,
      kind: input.kind,
      text: input.text,
      parseMode: input.parseMode ?? null,
      meta: input.meta ?? null,
    });
  },

  async list(filters: NotificationDeliveryListFilters): Promise<NotificationDeliveryListResult> {
    const db = getDb();
    const offset = (filters.page - 1) * filters.limit;
    const where = buildListWhere(filters);

    const query = db
      .select({
        id: notificationDeliveries.id,
        userId: notificationDeliveries.userId,
        kind: notificationDeliveries.kind,
        text: notificationDeliveries.text,
        parseMode: notificationDeliveries.parseMode,
        meta: notificationDeliveries.meta,
        sentAt: notificationDeliveries.sentAt,
        user: {
          id: users.id,
          telegramId: users.telegramId,
          username: users.username,
        },
      })
      .from(notificationDeliveries)
      .innerJoin(users, eq(notificationDeliveries.userId, users.id))
      .$dynamic()
      .orderBy(desc(notificationDeliveries.sentAt), desc(notificationDeliveries.id))
      .limit(filters.limit)
      .offset(offset);

    const countQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationDeliveries)
      .innerJoin(users, eq(notificationDeliveries.userId, users.id))
      .$dynamic();

    const [deliveries, countRows] = await Promise.all([
      where ? query.where(where) : query,
      where ? countQuery.where(where) : countQuery,
    ]);

    return {
      deliveries,
      total: countRows[0]?.count ?? 0,
      page: filters.page,
      limit: filters.limit,
    };
  },
};
