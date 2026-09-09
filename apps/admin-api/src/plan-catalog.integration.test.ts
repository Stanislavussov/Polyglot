/**
 * Bootstrap-only plan catalog — real-Postgres spec.
 *
 * The seed must create plans a database is missing and never touch one that
 * exists, because from that moment the admin panel owns the row (limits,
 * prices AND the feature junction). A synthetic catalog entry exercises both
 * halves without mutating the shared free/plus/pro matrix other workers use.
 */
import { planFeatureAccessRepository, rateLimitPlanRepository } from "@polyglot/adapter-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapPlanCatalog, type PlanCatalogEntry } from "./plan-catalog.js";

const PLAN = "it-boot-plan";

const syntheticCatalog: PlanCatalogEntry[] = [
  {
    name: PLAN,
    label: "Boot IT",
    translationLimit: 5,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "none",
    mentorDailyLimit: null,
    priceUsdCents: null,
    isActive: false,
    isDefault: false,
    features: ["grammarBreakdown", "mentor"],
  },
];

// beforeAll too: afterAll never runs on Ctrl-C or a worker crash, and a
// leftover row on a warm database would fail the creation assertion forever.
beforeAll(async () => {
  await rateLimitPlanRepository.delete(PLAN);
});

afterAll(async () => {
  await rateLimitPlanRepository.delete(PLAN);
});

describe("bootstrapPlanCatalog (integration)", () => {
  it("creates a missing plan with its feature junction, then never touches it again", async () => {
    expect(await bootstrapPlanCatalog(syntheticCatalog)).toEqual([PLAN]);
    expect((await planFeatureAccessRepository.findFeaturesForPlan(PLAN)).sort()).toEqual([
      "grammarBreakdown",
      "mentor",
    ]);

    // An admin retunes the plan and its features in the panel…
    await rateLimitPlanRepository.upsert({
      name: PLAN,
      label: "Boot IT (edited)",
      translationLimit: 99,
      creditCost: 1,
      videoLimit: null,
      videoWindow: "none",
      mentorDailyLimit: null,
      priceUsdCents: null,
      isActive: false,
      isDefault: false,
      aiModelId: null,
    });
    await planFeatureAccessRepository.setFeaturesForPlan(PLAN, ["voiceInput"]);

    // …and the next deploy's seed re-run must leave every edit standing.
    expect(await bootstrapPlanCatalog(syntheticCatalog)).toEqual([]);
    const plan = await rateLimitPlanRepository.findByName(PLAN);
    expect(plan?.label).toBe("Boot IT (edited)");
    expect(plan?.translationLimit).toBe(99);
    expect(await planFeatureAccessRepository.findFeaturesForPlan(PLAN)).toEqual(["voiceInput"]);
  });
});
