import type {
  AudienceGroup,
  FeatureAccessPort,
  FeatureAccessSubject,
  SettingsPort,
  SubscriptionPlan,
} from "@polyglot/core";
import { logger, resolveEntitlements } from "@polyglot/core";

interface PlanFeatureAccessReader {
  findFeaturesForPlan(planName: string): Promise<string[]>;
}

interface FeatureAccessDeps {
  settings: Pick<SettingsPort, "getPlanLimit">;
  planFeatureAccess: PlanFeatureAccessReader;
}

/**
 * Real FeatureAccessPort: resolves the subject's entitlements from their plan
 * (DB limits + plan_feature_access) with the admin/tester role override, then
 * grants access iff the resolved feature set contains the requested feature.
 */
export function createFeatureAccess(deps: FeatureAccessDeps): FeatureAccessPort {
  async function resolve(plan: SubscriptionPlan, audienceGroup: AudienceGroup): Promise<ReadonlySet<string>> {
    const [config, planFeatures] = await Promise.all([
      deps.settings.getPlanLimit(plan),
      deps.planFeatureAccess.findFeaturesForPlan(plan),
    ]);

    // Fail closed: a missing config for a paid plan falls back to free (denying
    // features). Log it so a "my Pro lost grammar" report is diagnosable.
    if (!config && plan !== "free") {
      logger.warn({ plan }, "Plan limit config missing; falling back to free entitlements");
    }

    return resolveEntitlements({ audienceGroup, plan, planConfig: config, planFeatures }).features;
  }

  function listFeatures(subject: FeatureAccessSubject): Promise<ReadonlySet<string>> {
    return resolve(subject.subscriptionPlan, subject.audienceGroup);
  }

  return {
    listFeatures,

    // "product" on purpose: the upgrade screen must advertise what the plan
    // itself buys, not what the viewer's own role would unlock on top of it.
    listPlanFeatures: (plan: SubscriptionPlan) => resolve(plan, "product"),

    async checkFeatureAccess(subject: FeatureAccessSubject, feature: string) {
      const features = await listFeatures(subject);
      return features.has(feature) ? { hasAccess: true } : { hasAccess: false, reason: "requires_upgrade" };
    },
  };
}
