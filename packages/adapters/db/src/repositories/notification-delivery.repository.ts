import type { SQL } from "drizzle-orm";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import { type NotificationDeliveryKind, notificationDeliveries, notificationInteractions, users } from "../schema.js";

export interface RecordNotificationDeliveryInput {
  userId: number;
  kind: NotificationDeliveryKind;
  text: string;
  parseMode?: "HTML" | null;
  meta?: Record<string, string | number | null>;
  telegramMessageId?: number | null;
}

export interface RecordNotificationInteractionInput {
  userId: number;
  telegramMessageId: number;
  action: string;
}

export interface LinkedNotificationInteraction {
  deliveryId: number;
  kind: NotificationDeliveryKind;
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
  /** When the first button on this message was tapped; null while nobody has. */
  openedAt: Date | null;
  interactionCount: number;
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
      telegramMessageId: input.telegramMessageId ?? null,
    });
  },

  /** Null, with nothing written, when the tapped message was not a journaled notification. */
  async recordInteraction(input: RecordNotificationInteractionInput): Promise<LinkedNotificationInteraction | null> {
    const db = getDb();
    const [delivery] = await db
      .select({ deliveryId: notificationDeliveries.id, kind: notificationDeliveries.kind })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.userId, input.userId),
          eq(notificationDeliveries.telegramMessageId, input.telegramMessageId),
        ),
      )
      .orderBy(desc(notificationDeliveries.id))
      .limit(1);
    if (!delivery) return null;

    await db.insert(notificationInteractions).values({ deliveryId: delivery.deliveryId, action: input.action });
    return delivery;
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
        openedAt: sql<Date | null>`(
          select min(${notificationInteractions.createdAt}) from ${notificationInteractions}
          where ${notificationInteractions.deliveryId} = ${notificationDeliveries.id}
        )`.mapWith((value: string | null) => (value === null ? null : new Date(value))),
        interactionCount: sql<number>`(
          select count(*)::int from ${notificationInteractions}
          where ${notificationInteractions.deliveryId} = ${notificationDeliveries.id}
        )`,
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
