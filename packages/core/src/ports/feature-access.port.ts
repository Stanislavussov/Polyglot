import type { AudienceGroup, SubscriptionPlan } from "./user.repository.js";

/**
 * Feature Access Port — controls access to premium/gated features.
 *
 * The real implementation resolves entitlements from the subject's plan +
 * audience group (see resolveEntitlements). The stub below always grants access
 * and is only used when no implementation is wired.
 */

export interface FeatureAccessResult {
  hasAccess: boolean;
  reason?: string;
}

/** Minimal user shape needed to decide feature access (satisfied by the loaded `ctx.user`). */
export interface FeatureAccessSubject {
  audienceGroup: AudienceGroup;
  subscriptionPlan: SubscriptionPlan;
}

export interface FeatureAccessPort {
  checkFeatureAccess(subject: FeatureAccessSubject, feature: string): Promise<FeatureAccessResult>;
}

/** Stub implementation — always grants access (used only when no real impl is wired). */
export const defaultFeatureAccess: FeatureAccessPort = {
  async checkFeatureAccess() {
    return { hasAccess: true };
  },
};
