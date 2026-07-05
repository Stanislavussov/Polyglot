import { and, eq, lte } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { Subscription, SubscriptionStatus } from "../schema.js";
import { subscriptions } from "../schema.js";

export type { Subscription, SubscriptionStatus };

export interface CreateSubscriptionInput {
  userId: number;
  plan: string;
  currentPeriodEnd: Date;
  provider?: string;
  externalId?: string | null;
}

export const subscriptionRepository = {
  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const db = getDb();
    const [row] = await db
      .insert(subscriptions)
      .values({
        userId: input.userId,
        plan: input.plan,
        currentPeriodEnd: input.currentPeriodEnd,
        provider: input.provider ?? "mock",
        externalId: input.externalId ?? null,
        status: "active",
      })
      .returning();
    return row!;
  },

  async findActiveByUser(userId: number): Promise<Subscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Active subscriptions whose paid period has ended by `now` — the cron sweep set. */
  async findExpired(now: Date): Promise<Subscription[]> {
    const db = getDb();
    return db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.status, "active"), lte(subscriptions.currentPeriodEnd, now)));
  },

  async extend(id: number, newPeriodEnd: Date): Promise<void> {
    const db = getDb();
    await db
      .update(subscriptions)
      .set({ currentPeriodEnd: newPeriodEnd, status: "active", updatedAt: new Date() })
      .where(eq(subscriptions.id, id));
  },

  async updateStatus(id: number, status: SubscriptionStatus): Promise<void> {
    const db = getDb();
    await db.update(subscriptions).set({ status, updatedAt: new Date() }).where(eq(subscriptions.id, id));
  },
};
