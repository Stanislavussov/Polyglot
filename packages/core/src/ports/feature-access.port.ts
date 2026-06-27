/**
 * Feature Access Port — controls access to premium/gated features.
 *
 * Stub implementation always grants access. Replace with real
 * subscription checks when payment integration is ready.
 */

export interface FeatureAccessResult {
  hasAccess: boolean;
  reason?: string;
}

export interface FeatureAccessPort {
  checkFeatureAccess(userId: number, feature: string): Promise<FeatureAccessResult>;
}

/** Stub implementation — always grants access */
export const defaultFeatureAccess: FeatureAccessPort = {
  async checkFeatureAccess() {
    return { hasAccess: true };
  },
};
