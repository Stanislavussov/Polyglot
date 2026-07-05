import { eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { planFeatureAccess } from "../schema.js";

/**
 * Junction repository gating which premium feature keys each plan unlocks.
 * Mirrors the aiModelPlanAccess pattern (delete + re-insert for a plan).
 */
export const planFeatureAccessRepository = {
  async findFeaturesForPlan(planName: string): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ featureKey: planFeatureAccess.featureKey })
      .from(planFeatureAccess)
      .where(eq(planFeatureAccess.planName, planName));
    return rows.map((r) => r.featureKey);
  },

  async setFeaturesForPlan(planName: string, featureKeys: string[]): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(planFeatureAccess).where(eq(planFeatureAccess.planName, planName));
      if (featureKeys.length > 0) {
        await tx.insert(planFeatureAccess).values(featureKeys.map((featureKey) => ({ planName, featureKey })));
      }
    });
  },
};
