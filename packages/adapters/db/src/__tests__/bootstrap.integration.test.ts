/**
 * Fresh-database bootstrap — integration spec (Task 71 v2).
 *
 * Proves that a brand-new, empty database provisioned through the prod path
 * (`db:migrate`, which includes the languages data-seed migrations) plus the
 * bootstrap seed (`pnpm admin:seed` → plans + feature access) contains every
 * piece of base configuration the app cannot function without:
 *
 * - `languages` rows — loaded into the in-memory registry at bot startup
 *   (`loadLanguageCache`); an empty table silently produces an empty registry
 *   and breaks every language flow.
 * - `rate_limit_plans` — `users.subscription_plan` defaults to "free"; without
 *   a matching default plan row, entitlement resolution has no limits to apply.
 * - `plan_feature_access` — paid plans gate premium features through this
 *   junction; missing rows silently disable grammar/etymology for paid users.
 *
 * (`ai_models`, `system_settings`, and `translation_presets` are deliberately
 * NOT asserted: code falls back to hardcoded defaults when they are empty.)
 */
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { languages, planFeatureAccess, rateLimitPlans } from "../schema.js";

describe("fresh-DB bootstrap (integration)", () => {
  it("migrations seeded the languages reference table", async () => {
    const rows = await getDb().select().from(languages);
    // 45 languages from migration 0002 + Kazakh from 0040.
    expect(rows.length).toBeGreaterThanOrEqual(40);
    const supported = rows.filter((row) => row.isSupported);
    expect(supported.length).toBeGreaterThanOrEqual(11);
    // The registry loader requires codes; spot-check the languages the bot's
    // onboarding offers first.
    const codes = new Set(rows.map((row) => row.code));
    for (const code of ["en", "ru", "cs", "de", "kk"]) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it("bootstrap seed created the plans with a single default", async () => {
    const plans = await getDb().select().from(rateLimitPlans);
    const names = new Set(plans.map((plan) => plan.name));
    for (const name of ["free", "plus", "pro", "unlimited"]) {
      expect(names.has(name)).toBe(true);
    }
    // users.subscription_plan defaults to "free" — exactly that plan must be
    // the default entitlement fallback.
    const defaults = plans.filter((plan) => plan.isDefault);
    expect(defaults.map((plan) => plan.name)).toEqual(["free"]);
  });

  it("bootstrap seed granted premium features to paid plans only", async () => {
    const rows = await getDb().select().from(planFeatureAccess);
    const byPlan = new Map<string, string[]>();
    for (const row of rows) {
      byPlan.set(row.planName, [...(byPlan.get(row.planName) ?? []), row.featureKey]);
    }
    for (const paid of ["plus", "pro", "unlimited"]) {
      expect(byPlan.get(paid) ?? []).toEqual(
        expect.arrayContaining(["grammarBreakdown", "etymology", "grammarDetail"]),
      );
    }
    expect(byPlan.has("free")).toBe(false);
  });
});
