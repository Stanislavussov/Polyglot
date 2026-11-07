export type { Entitlements, FeatureKey, PlanEntitlementConfig, ResolveEntitlementsInput } from "./entitlements.js";
export {
  ALL_FEATURES,
  FEATURE_KEYS,
  FREE_FALLBACK,
  isUnlimitedRole,
  ROLE_ONLY_FEATURES,
  resolveEntitlements,
} from "./entitlements.js";
export type { AiCallType, QuotaDecision, QuotaPorts, QuotaSubject } from "./quota.js";
export {
  AI_CALL_WEIGHTS,
  checkAiQuota,
  checkDailyCeiling,
  checkTranslationQuota,
  recordAiUsage,
  resolvePlanLimit,
} from "./quota.js";
