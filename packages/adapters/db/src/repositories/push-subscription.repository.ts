import type { PushSubscriptionRepository, StoredPushSubscription } from "@polyglot/core";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { pushSubscriptions } from "../schema.js";

export const pushSubscriptionRepository: PushSubscriptionRepository = {
  async upsert({ userId, endpoint, keys, userAgent }): Promise<void> {
    const db = getDb();
    // The endpoint identifies a browser install, not a person: when another account
    // signs in on the same device, the subscription follows the new owner.
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
      });
  },

  async listForUser(userId: number): Promise<StoredPushSubscription[]> {
    const db = getDb();
    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth },
    }));
  },

  async countForUser(userId: number): Promise<number> {
    const db = getDb();
    const rows = await db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    return rows[0]?.n ?? 0;
  },

  async removeForUser(userId: number, endpoint: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    return rows.length > 0;
  },

  async remove(id: number): Promise<void> {
    await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  },

  async markSuccess(id: number): Promise<void> {
    await getDb().update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, id));
  },
};
