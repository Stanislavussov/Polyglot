import type { VideoWindow } from "../../ports/settings.port.js";
import type { AudienceGroup, SubscriptionPlan } from "../../ports/user.repository.js";

/**
 * Entitlements resolver — the single source of truth for "what can this user do".
 *
 * Two axes combine here:
 *  - `subscriptionPlan` (free/plus/pro/unlimited) — what the user paid for
 *  - `audienceGroup` (admin/tester/product) — who the user is internally
 *
 * Precedence: the role override wins first (admin/tester ⇒ everything unlimited +
 * all features), otherwise plan entitlements apply. A small `ROLE_ONLY_FEATURES`
 * set is never granted by a plan (reserved for internal/beta features).
 */

export const FEATURE_KEYS = {
  grammarBreakdown: "grammarBreakdown",
  etymology: "etymology",
  grammarDetail: "grammarDetail",
  /** "Clarify translation" and "Other meaning" — one key, both re-run the pipeline. */
  clarification: "clarification",
  /** Spoken word (TTS) — `tr:say:*`. */
  pronunciation: "pronunciation",
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

export const ALL_FEATURES: readonly string[] = Object.values(FEATURE_KEYS);

/** Features only internal roles (admin/tester) ever get — never unlocked by a plan. Empty for now. */
export const ROLE_ONLY_FEATURES: readonly string[] = [];

/** Audience groups that bypass every plan limit. */
const UNLIMITED_ROLES: readonly AudienceGroup[] = ["admin", "tester"];

export interface PlanEntitlementConfig {
  translationLimit: number | null;
  videoLimit: number | null;
  videoWindow: VideoWindow;
}

export interface Entitlements {
  /** Max top-level translations per calendar month (UTC). null = unlimited. */
  translationsPerMonth: number | null;
  video: { limit: number | null; window: VideoWindow };
  features: Set<string>;
}

export interface ResolveEntitlementsInput {
  audienceGroup: AudienceGroup;
  plan: SubscriptionPlan;
  /** Plan limits from the DB (null when the plan is unknown → treated as free). */
  planConfig: PlanEntitlementConfig | null;
  /** Feature keys the plan unlocks (from plan_feature_access). */
  planFeatures: string[];
}

/**
 * Conservative fallback when a plan config is missing — treat the user as free.
 * Must mirror the seeded `free` plan (Task 79): translation is the only thing a
 * free account gets, so a missing config can never accidentally hand out video.
 */
const FREE_FALLBACK: PlanEntitlementConfig = {
  translationLimit: 10,
  videoLimit: 0,
  videoWindow: "none",
};

export function isUnlimitedRole(audienceGroup: AudienceGroup): boolean {
  return UNLIMITED_ROLES.includes(audienceGroup);
}

export function resolveEntitlements(input: ResolveEntitlementsInput): Entitlements {
  // Role override beats any plan: admin/tester get everything, unconditionally.
  if (isUnlimitedRole(input.audienceGroup)) {
    return {
      translationsPerMonth: null,
      video: { limit: null, window: "monthly" },
      features: new Set(ALL_FEATURES),
    };
  }

  const config = input.planConfig ?? FREE_FALLBACK;
  const features = new Set(input.planFeatures.filter((key) => !ROLE_ONLY_FEATURES.includes(key)));

  return {
    translationsPerMonth: config.translationLimit,
    video: { limit: config.videoLimit, window: config.videoWindow },
    features,
  };
}
