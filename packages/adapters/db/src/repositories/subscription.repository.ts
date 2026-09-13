import { TRIAL_PROVIDER } from "@polyglot/core";
import { and, desc, eq, gte, lte } from "drizzle-orm";
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
  /** Supplied when it must share a clock with `currentPeriodEnd`; otherwise `now()`. */
  createdAt?: Date;
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
        ...(input.createdAt && { createdAt: input.createdAt }),
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

  /**
   * Any trial row this user has ever held, in any status — the once-per-account
   * guard for the onboarding trial. Status is deliberately not filtered: a spent
   * trial is still spent.
   */
  async findTrialByUser(userId: number): Promise<Subscription | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.provider, TRIAL_PROVIDER)))
      .orderBy(desc(subscriptions.id))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Trial rows ending inside the window — the lifecycle sweep set (any status). */
  async findTrialsEndingBetween(since: Date, cutoff: Date): Promise<Subscription[]> {
    const db = getDb();
    return db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, TRIAL_PROVIDER),
          gte(subscriptions.currentPeriodEnd, since),
          lte(subscriptions.currentPeriodEnd, cutoff),
        ),
      );
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
