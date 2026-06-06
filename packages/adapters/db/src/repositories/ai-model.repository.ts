import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { AIModelRow } from "../schema.js";
import { aiModelPlanAccess, aiModels } from "../schema.js";

export type { AIModelRow };

export type AIModelWithPlans = AIModelRow & {
  allowedPlans: string[];
};

type AIModelUpsert = Omit<AIModelRow, "updatedAt"> & {
  allowedPlans?: string[];
};

function withAllowedPlans(model: AIModelRow, planRows: { modelId: string; planName: string }[]): AIModelWithPlans {
  return {
    ...model,
    allowedPlans: planRows.filter((row) => row.modelId === model.id).map((row) => row.planName),
  };
}

async function attachAllowedPlans(models: AIModelRow[]): Promise<AIModelWithPlans[]> {
  if (models.length === 0) {
    return [];
  }

  const db = getDb();
  const ids = models.map((model) => model.id);
  const planRows = await db.select().from(aiModelPlanAccess).where(inArray(aiModelPlanAccess.modelId, ids));
  return models.map((model) => withAllowedPlans(model, planRows));
}

export const aiModelRepository = {
  async findAll(): Promise<AIModelWithPlans[]> {
    const db = getDb();
    const models = await db.select().from(aiModels).orderBy(aiModels.provider, aiModels.name);
    return attachAllowedPlans(models);
  },

  async findEnabled(): Promise<AIModelWithPlans[]> {
    const db = getDb();
    const models = await db
      .select()
      .from(aiModels)
      .where(eq(aiModels.isEnabled, true))
      .orderBy(aiModels.provider, aiModels.name);
    return attachAllowedPlans(models);
  },

  async findEnabledForPlan(plan: string): Promise<AIModelWithPlans[]> {
    const db = getDb();
    const rows = await db
      .select({ model: aiModels })
      .from(aiModels)
      .innerJoin(aiModelPlanAccess, eq(aiModels.id, aiModelPlanAccess.modelId))
      .where(and(eq(aiModels.isEnabled, true), eq(aiModelPlanAccess.planName, plan)))
      .orderBy(aiModels.provider, aiModels.name);
    return attachAllowedPlans(rows.map((row) => row.model));
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

  async findDefaultForPlan(plan: string): Promise<AIModelWithPlans | null> {
    const db = getDb();
    const rows = await db
      .select({ model: aiModels })
      .from(aiModels)
      .innerJoin(aiModelPlanAccess, eq(aiModels.id, aiModelPlanAccess.modelId))
      .where(and(eq(aiModels.isEnabled, true), eq(aiModels.isDefault, true), eq(aiModelPlanAccess.planName, plan)))
      .limit(1);
    if (rows[0]) {
      return attachAllowedPlans([rows[0].model]).then((models) => models[0] ?? null);
    }

    const enabled = await this.findEnabledForPlan(plan);
    return enabled[0] ?? null;
  },

  async upsert(data: AIModelUpsert): Promise<AIModelWithPlans> {
    const db = getDb();
    return db.transaction(async (tx) => {
      const { allowedPlans, ...modelData } = data;
      const rows = await tx
        .insert(aiModels)
        .values({ ...modelData, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: aiModels.id,
          set: { ...modelData, updatedAt: new Date() },
        })
        .returning();

      const model = rows[0]!;
      if (allowedPlans !== undefined) {
        await tx.delete(aiModelPlanAccess).where(eq(aiModelPlanAccess.modelId, model.id));
        if (allowedPlans.length > 0) {
          await tx.insert(aiModelPlanAccess).values(
            allowedPlans.map((planName) => ({
              modelId: model.id,
              planName,
            })),
          );
        }
      }

      const planRows = await tx.select().from(aiModelPlanAccess).where(eq(aiModelPlanAccess.modelId, model.id));
      return withAllowedPlans(model, planRows);
    });
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
};
