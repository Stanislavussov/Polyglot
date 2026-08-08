import { and, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { AIModelRow } from "../schema.js";
import { aiModels, rateLimitPlans } from "../schema.js";

export type { AIModelRow };

type AIModelUpsert = Omit<AIModelRow, "updatedAt">;

export const aiModelRepository = {
  async findAll(): Promise<AIModelRow[]> {
    const db = getDb();
    return db.select().from(aiModels).orderBy(aiModels.provider, aiModels.name);
  },

  async findEnabled(): Promise<AIModelRow[]> {
    const db = getDb();
    return db.select().from(aiModels).where(eq(aiModels.isEnabled, true)).orderBy(aiModels.provider, aiModels.name);
  },

  async findById(id: string): Promise<AIModelRow | null> {
    const db = getDb();
    const rows = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async findDefault(): Promise<AIModelRow | null> {
    const db = getDb();
    const rows = await db.select().from(aiModels).where(eq(aiModels.isDefault, true)).limit(1);
    return rows[0] ?? null;
  },

  /**
   * The admin-chosen failover model. Restricted to ENABLED rows on purpose: a
   * disabled model is one the bot is not allowed to call, so a stale flag on a
   * disabled row must read as "no fallback configured" (the caller then runs
   * without failover) rather than routing failover at a model we just turned off.
   */
  async findFallback(): Promise<AIModelRow | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(aiModels)
      .where(and(eq(aiModels.isFallback, true), eq(aiModels.isEnabled, true)))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * The model explicitly routed to a plan, or `null` when the plan has no model of
   * its own (the caller then uses the global default). Only ENABLED models are
   * returned, for the same reason as {@link findFallback}.
   */
  async findForPlan(plan: string): Promise<AIModelRow | null> {
    const db = getDb();
    const rows = await db
      .select({ model: aiModels })
      .from(rateLimitPlans)
      .innerJoin(aiModels, eq(rateLimitPlans.aiModelId, aiModels.id))
      .where(and(eq(rateLimitPlans.name, plan), eq(aiModels.isEnabled, true)))
      .limit(1);
    return rows[0]?.model ?? null;
  },

  async upsert(data: AIModelUpsert): Promise<AIModelRow> {
    const db = getDb();
    const rows = await db
      .insert(aiModels)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: aiModels.id,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return rows[0]!;
  },

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(aiModels).where(eq(aiModels.id, id));
  },

  async setDefault(id: string): Promise<void> {
    const db = getDb();
    await db.update(aiModels).set({ isDefault: false, updatedAt: new Date() });
    await db.update(aiModels).set({ isDefault: true, updatedAt: new Date() }).where(eq(aiModels.id, id));
  },

  /**
   * Single-winner flag, same shape as {@link setDefault}: clear everywhere, then
   * set one. `null` clears the role entirely — an admin who wants no failover at
   * all must be able to say so, and the bot then runs unsplit on the primary.
   */
  async setFallback(id: string | null): Promise<void> {
    const db = getDb();
    await db.update(aiModels).set({ isFallback: false, updatedAt: new Date() });
    if (id !== null) {
      await db.update(aiModels).set({ isFallback: true, updatedAt: new Date() }).where(eq(aiModels.id, id));
    }
  },
};
