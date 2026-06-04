import type { SubscriptionPlan } from "../../ports/user.repository.js";

export interface PlanLimit {
  plan: SubscriptionPlan;
  label: string;
  creditsPerDay: number | null;
}

export interface RateLimitStatus {
  allowed: boolean;
  plan: PlanLimit;
  usedCredits: number;
  requestedCredits: number;
  remainingCredits: number | null;
  resetsAt: Date;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimit> = {
  free: { plan: "free", label: "Free", creditsPerDay: 50 },
  plus: { plan: "plus", label: "Plus", creditsPerDay: 300 },
  pro: { plan: "pro", label: "Pro", creditsPerDay: 1500 },
  unlimited: { plan: "unlimited", label: "Unlimited", creditsPerDay: null },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSLATION_REQUEST_CREDIT_COST = 1;

export function getPlanLimit(plan: SubscriptionPlan): PlanLimit {
  return PLAN_LIMITS[plan];
}

export function calculateTranslationCreditCost(): number {
  return TRANSLATION_REQUEST_CREDIT_COST;
}

export function getDailyWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - DAY_MS);
}

export function getDailyWindowReset(now = new Date()): Date {
  return new Date(now.getTime() + DAY_MS);
}

export function evaluateRateLimit(
  plan: SubscriptionPlan,
  usedCredits: number,
  requestedCredits: number,
  resetsAt: Date,
): RateLimitStatus {
  const planLimit = getPlanLimit(plan);
  const remainingCredits = planLimit.creditsPerDay === null ? null : Math.max(0, planLimit.creditsPerDay - usedCredits);

  return {
    allowed: planLimit.creditsPerDay === null || usedCredits + requestedCredits <= planLimit.creditsPerDay,
    plan: planLimit,
    usedCredits,
    requestedCredits,
    remainingCredits,
    resetsAt,
  };
}
