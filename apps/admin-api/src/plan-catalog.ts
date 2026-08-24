import { planFeatureAccessRepository, rateLimitPlanRepository } from "@polyglot/adapter-db";
import { featureKeySchema } from "@polyglot/admin-contracts";
import type { z } from "zod";

type FeatureKey = z.infer<typeof featureKeySchema>;

export interface PlanCatalogEntry {
  name: string;
  label: string;
  translationLimit: number | null;
  creditCost: number;
  videoLimit: number | null;
  videoWindow: "none" | "lifetime" | "monthly";
  mentorDailyLimit: number | null;
  priceUsdCents: number | null;
  isActive: boolean;
  isDefault: boolean;
  features: FeatureKey[];
}

// Task 79 tier matrix — the shape a fresh database starts with. Free is
// translation-only; Plus adds the clarify/other-meaning pair, unmetered
// translation and monthly video; Pro is the only plan with word audio (TTS),
// the most expensive thing on a card. Plus is unmetered on purpose: the tier is
// priced on the assumption that a typical subscriber never approaches a cap, so
// the heavy user is covered by the many who are not.
const GRAMMAR_FEATURES: FeatureKey[] = ["grammarBreakdown", "etymology", "grammarDetail"];
const PLUS_FEATURES: FeatureKey[] = [...GRAMMAR_FEATURES, "clarification", "mentor"];
const PRO_FEATURES: FeatureKey[] = [...PLUS_FEATURES, "pronunciation", "voiceInput"];

export const DEFAULT_PLAN_CATALOG: PlanCatalogEntry[] = [
  {
    name: "free",
    label: "Free",
    translationLimit: 10,
    creditCost: 1,
    videoLimit: 0,
    videoWindow: "none",
    mentorDailyLimit: 0,
    priceUsdCents: null,
    isActive: true,
    isDefault: true,
    features: [],
  },
  {
    name: "plus",
    label: "Plus",
    translationLimit: null,
    creditCost: 1,
    videoLimit: 20,
    videoWindow: "monthly",
    // The mentor model is priced above the translate default, so unmetered
    // Plus still caps the expensive calls; unlimited mentor is Pro's pitch.
    mentorDailyLimit: 30,
    priceUsdCents: 500,
    isActive: true,
    isDefault: false,
    features: PLUS_FEATURES,
  },
  {
    name: "pro",
    label: "Pro",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "monthly",
    mentorDailyLimit: null,
    priceUsdCents: 1000,
    isActive: true,
    isDefault: false,
    features: PRO_FEATURES,
  },
  {
    name: "unlimited",
    label: "Unlimited",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "monthly",
    mentorDailyLimit: null,
    priceUsdCents: null,
    isActive: true,
    isDefault: false,
    features: PRO_FEATURES,
  },
];

/**
 * Bootstrap-only: creates catalog plans (columns + feature junction) that are
 * missing and leaves every existing plan completely untouched. The admin panel
 * is the source of truth for limits, prices AND feature access from the moment
 * a plan row exists — the same ownership rule the AI-model and word-picker
 * blocks of the seed already follow. Re-asserting rows here would silently
 * revert an admin's edits on every production deploy.
 *
 * Consequence for rollouts: editing DEFAULT_PLAN_CATALOG affects FRESH
 * databases only. Shipping a new feature key to existing environments (prod,
 * dev) means granting it on the Rate Limits page — adding it to a plan's
 * `features` here alone leaves it gated off for every current user.
 */
export async function bootstrapPlanCatalog(catalog: PlanCatalogEntry[] = DEFAULT_PLAN_CATALOG): Promise<string[]> {
  const existing = new Set((await rateLimitPlanRepository.findAll()).map((plan) => plan.name));
  const created: string[] = [];
  for (const { features, ...plan } of catalog) {
    if (existing.has(plan.name)) continue;
    await rateLimitPlanRepository.upsert({ ...plan, aiModelId: null });
    await planFeatureAccessRepository.setFeaturesForPlan(plan.name, features);
    created.push(plan.name);
  }
  return created;
}
