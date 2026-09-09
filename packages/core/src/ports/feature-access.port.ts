import { ALL_FEATURES } from "../modules/entitlements/index.js";
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
  /**
   * Every feature key the subject may use. Rendering a card asks this once
   * instead of asking `checkFeatureAccess` per button — one plan lookup per
   * card, not one per gated feature.
   */
  listFeatures(subject: FeatureAccessSubject): Promise<ReadonlySet<string>>;
  /**
   * What a plan advertises, independent of who is asking — the upgrade screen
   * describes plans the viewer is not on, so it cannot go through `listFeatures`.
   */
  listPlanFeatures(plan: SubscriptionPlan): Promise<ReadonlySet<string>>;
  checkFeatureAccess(subject: FeatureAccessSubject, feature: string): Promise<FeatureAccessResult>;
}

/** Stub implementation — always grants access (used only when no real impl is wired). */
export const defaultFeatureAccess: FeatureAccessPort = {
  async listFeatures() {
    return new Set(ALL_FEATURES);
  },
  async listPlanFeatures() {
    return new Set(ALL_FEATURES);
  },
  async checkFeatureAccess() {
    return { hasAccess: true };
  },
};
