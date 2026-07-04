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

const DAY_MS = 24 * 60 * 60 * 1000;

export function getDailyWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - DAY_MS);
}

export function getDailyWindowReset(now = new Date()): Date {
  return new Date(now.getTime() + DAY_MS);
}

/**
 * Pure rate-limit policy. The plan limit is always supplied by the caller from
 * the DB-backed settings source (`SettingsPort`) — there is deliberately no
 * hardcoded plan table or `SubscriptionPlan`-keyed variant here (Fable T21/A7),
 * so a tariff change in the admin panel takes effect without a release.
 */
export function evaluatePlanRateLimit(
  planLimit: PlanLimit,
  usedCredits: number,
  requestedCredits: number,
  resetsAt: Date,
): RateLimitStatus {
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
