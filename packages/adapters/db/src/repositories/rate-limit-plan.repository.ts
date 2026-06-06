import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { RateLimitPlan } from "../schema.js";
import { rateLimitPlans, users } from "../schema.js";

export type { RateLimitPlan };

export const rateLimitPlanRepository = {
  async findAll(): Promise<RateLimitPlan[]> {
    const db = getDb();
    return db.select().from(rateLimitPlans).orderBy(rateLimitPlans.name);
  },

  async findByName(name: string): Promise<RateLimitPlan | null> {
    const db = getDb();
    const rows = await db.select().from(rateLimitPlans).where(eq(rateLimitPlans.name, name)).limit(1);
    return rows[0] ?? null;
  },

  async findDefault(): Promise<RateLimitPlan | null> {
    const db = getDb();
    const rows = await db.select().from(rateLimitPlans).where(eq(rateLimitPlans.isDefault, true)).limit(1);
    return rows[0] ?? null;
  },

  async upsert(data: Omit<RateLimitPlan, "updatedAt">): Promise<RateLimitPlan> {
    const db = getDb();
    return db.transaction(async (tx) => {
      if (data.isDefault) {
        await tx.update(rateLimitPlans).set({ isDefault: false, updatedAt: new Date() });
      }

      const rows = await tx
        .insert(rateLimitPlans)
        .values({ ...data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: rateLimitPlans.name,
          set: { ...data, updatedAt: new Date() },
        })
        .returning();
      return rows[0]!;
    });
  },

  async delete(name: string): Promise<{ fallbackPlan: string; reassignedUsers: number }> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const planRows = await tx.select().from(rateLimitPlans).where(eq(rateLimitPlans.name, name)).limit(1);
      const plan = planRows[0];
      if (!plan) {
        return { fallbackPlan: "", reassignedUsers: 0 };
      }

      if (plan.isDefault) {
        throw new Error("Cannot delete the default plan");
      }

      const fallbackRows = await tx
        .select()
        .from(rateLimitPlans)
        .where(and(eq(rateLimitPlans.isDefault, true), ne(rateLimitPlans.name, name)))
        .limit(1);
      const fallback = fallbackRows[0];
      if (!fallback) {
        throw new Error("Default plan is not configured");
      }

      const reassigned = await tx
        .update(users)
        .set({ subscriptionPlan: fallback.name })
        .where(eq(users.subscriptionPlan, name))
        .returning({ id: users.id });

      await tx.delete(rateLimitPlans).where(eq(rateLimitPlans.name, name));
      return { fallbackPlan: fallback.name, reassignedUsers: reassigned.length };
    });
  },
};
