import type { FeatureAccessPort, FeatureAccessSubject, SettingsPort, SubscriptionPlan } from "@polyglot/core";
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
  return {
    async checkFeatureAccess(subject: FeatureAccessSubject, feature: string) {
      const plan: SubscriptionPlan = subject.subscriptionPlan;
      const [config, planFeatures] = await Promise.all([
        deps.settings.getPlanLimit(plan),
        deps.planFeatureAccess.findFeaturesForPlan(plan),
      ]);

      // Fail closed: a missing config for a paid plan falls back to free (denying
      // features). Log it so a "my Pro lost grammar" report is diagnosable.
      if (!config && plan !== "free") {
        logger.warn({ plan }, "Plan limit config missing; falling back to free entitlements");
      }

      const entitlements = resolveEntitlements({
        audienceGroup: subject.audienceGroup,
        plan,
        planConfig: config,
        planFeatures,
      });

      return entitlements.features.has(feature)
        ? { hasAccess: true }
        : { hasAccess: false, reason: "requires_upgrade" };
    },
  };
}
