/**
 * plan_feature_access junction — real-Postgres round-trip.
 *
 * The admin panel now owns this junction (PUT /rate-limits), so the repository
 * semantics it relies on are pinned here: set replaces atomically, an empty set
 * clears, and deleting a plan cascades its junction rows. A synthetic plan is
 * used throughout so concurrently running workers never see the shared tier
 * matrix (free/plus/pro) mutated underneath them.
 */
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { planFeatureAccessRepository } from "../repositories/plan-feature-access.repository.js";
import { rateLimitPlanRepository } from "../repositories/rate-limit-plan.repository.js";
import { planFeatureAccess, rateLimitPlans } from "../schema.js";

const PLAN = "it-junction-plan";

async function arrangePlan(): Promise<void> {
  await rateLimitPlanRepository.upsert({
    name: PLAN,
    label: "Junction IT",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "none",
    mentorDailyLimit: null,
    // Not for sale and inactive: invisible to upgrade screens rendered by
    // other integration tests sharing this database.
    priceUsdCents: null,
    isActive: false,
    isDefault: false,
    aiModelId: null,
  });
}

afterAll(async () => {
  await getDb().delete(rateLimitPlans).where(eq(rateLimitPlans.name, PLAN));
});

describe("planFeatureAccessRepository (integration)", () => {
  it("replaces the plan's feature set atomically and clears it on an empty list", async () => {
    await arrangePlan();

    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, ["mentor", "clarification"]);
    expect((await planFeatureAccessRepository.findFeaturesForPlan(PLAN)).sort()).toEqual(["clarification", "mentor"]);

    // Replace, not merge: keys absent from the new set must disappear.
    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, ["voiceInput"]);
    expect(await planFeatureAccessRepository.findFeaturesForPlan(PLAN)).toEqual(["voiceInput"]);

    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, []);
    expect(await planFeatureAccessRepository.findFeaturesForPlan(PLAN)).toEqual([]);
  });

  it("cascades junction rows away with the plan", async () => {
    await arrangePlan();
    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, ["mentor"]);

    await getDb().delete(rateLimitPlans).where(eq(rateLimitPlans.name, PLAN));

    const orphans = await getDb().select().from(planFeatureAccess).where(eq(planFeatureAccess.planName, PLAN));
    expect(orphans).toEqual([]);
  });
});
