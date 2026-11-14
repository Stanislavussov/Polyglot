import type { PlanLimitConfig, SettingsPort } from "../../ports/settings.port.js";
import type { SubscriptionRepository } from "../../ports/subscription.repository.js";
import type { TranslationRequestRepository } from "../../ports/translation-request.repository.js";
import type { AudienceGroup, SubscriptionPlan } from "../../ports/user.repository.js";
import { evaluateDailyCeiling } from "../rate-limit/daily-ceiling.js";
import {
  evaluatePlanRateLimit,
  getDailyWindowReset,
  getDailyWindowStart,
  getMonthlyWindowReset,
  getMonthlyWindowStart,
} from "../rate-limit/rate-limit.service.js";
import { resolveMeteredWindowStart } from "../subscriptions/trial.js";
import { isUnlimitedRole, resolveEntitlements } from "./entitlements.js";

/**
 * Credit weight per paid AI call type (Fable T16). Every paid AI call goes
 * through the same meter; a heavier call (a full mentor turn, phrase extraction
 * over a long video transcript) costs more than a single-word translation.
 */
export const AI_CALL_WEIGHTS = {
  translate: 1,
  mentor: 2,
  dictionaryTranslate: 1,
  video: 5,
  // A capped article body is a fraction of a long transcript's input.
  article: 3,
  wordPick: 3,
  etymology: 1,
  grammarCheck: 2,
  // A check the service refused as outside the user's languages. Same cost as a
  // check, but its own ledger tag: the daily allowance counts "[grammarCheck]" rows
  // only, so a mistaken language spends credits, never one of the day's checks.
  grammarCheckOutOfSet: 2,
  expression: 1,
} as const;

export type AiCallType = keyof typeof AI_CALL_WEIGHTS;

export interface QuotaPorts {
  settings: SettingsPort;
  translationRequests: Pick<
    TranslationRequestRepository,
    "getUserCreditsInWindow" | "logTranslationRequest" | "countRequestsInWindow"
  >;
  subscriptions?: Pick<SubscriptionRepository, "findTrialByUser">;
}

/** The container slice a channel holds; both the bot and the web app meter through this one assembly. */
export interface QuotaServices {
  settings: SettingsPort;
  translationRequestRepository: QuotaPorts["translationRequests"];
  subscriptionRepository?: QuotaPorts["subscriptions"];
}

export function buildQuotaPorts(services: QuotaServices): QuotaPorts {
  return {
    settings: services.settings,
    translationRequests: services.translationRequestRepository,
    ...(services.subscriptionRepository ? { subscriptions: services.subscriptionRepository } : {}),
  };
}

export interface QuotaSubject {
  id: number;
  audienceGroup: AudienceGroup;
  subscriptionPlan: SubscriptionPlan;
}

/**
 * `plan` = the plan's own allowance ran out (an upgrade helps);
 * `daily_ceiling` = the ops guard nobody is exempt from (an upgrade does not help).
 */
export type QuotaDecision =
  | { ok: true; creditCost: number }
  | { ok: false; reason: "plan" | "daily_ceiling"; resetAt: Date; ceiling?: number; usedCredits?: number };

/**
 * Resolves a user's plan limit from the single DB-backed settings source
 * (Fable T21/A7). `getPlanLimit` returns `null` only when the plan name is absent
 * from both the DB and the service's fallback table; then the configured default
 * plan applies (never a hardcoded table).
 */
export async function resolvePlanLimit(settings: SettingsPort, plan: SubscriptionPlan): Promise<PlanLimitConfig> {
  const direct = await settings.getPlanLimit(plan);
  if (direct) return direct;

  const all = await settings.getPlanLimits();
  const fallback = all.find((p) => p.isDefault) ?? all[0];
  if (!fallback) {
    throw new Error("No plan limits configured (settings source returned an empty plan table)");
  }
  return fallback;
}

function ceilingDecision(
  usedCredits: number,
  requestedCredits: number,
  planCeiling: number | null | undefined,
): QuotaDecision {
  const status = evaluateDailyCeiling(usedCredits, requestedCredits, planCeiling);
  if (status.allowed) return { ok: true, creditCost: requestedCredits };
  return {
    ok: false,
    reason: "daily_ceiling",
    resetAt: getDailyWindowReset(),
    ceiling: status.ceiling,
    usedCredits: status.usedCredits,
  };
}

/**
 * The daily credit meter for every paid AI call except translate. An internal
 * role bypasses the plan limit but never the safety ceiling, and is billed at the
 * bare call weight (no plan read means no per-request cost is known).
 */
export async function checkAiQuota(
  ports: QuotaPorts,
  user: QuotaSubject,
  callType: AiCallType,
): Promise<QuotaDecision> {
  const weight = AI_CALL_WEIGHTS[callType];
  const internal = isUnlimitedRole(user.audienceGroup);
  const usedCredits = await ports.translationRequests.getUserCreditsInWindow(user.id, getDailyWindowStart());
  const planLimit = internal ? null : await resolvePlanLimit(ports.settings, user.subscriptionPlan);
  const requestedCredits = planLimit ? planLimit.creditCost * weight : weight;

  if (planLimit) {
    const status = evaluatePlanRateLimit(
      { plan: planLimit.name, label: planLimit.label, creditsPerDay: planLimit.translationLimit },
      usedCredits,
      requestedCredits,
      getDailyWindowReset(),
    );
    if (!status.allowed) return { ok: false, reason: "plan", resetAt: status.resetsAt };
  }

  // Ordered last on purpose: a metered plan that ran out meets its own limit
  // (and the upgrade offer) first; this is the ops guard.
  return ceilingDecision(usedCredits, requestedCredits, planLimit?.dailyCreditCeiling);
}

/**
 * The translate gate: a monthly (calendar-UTC) allowance rebased on a trial that
 * ended this month, then the daily safety ceiling. Unlimited plans and internal
 * roles skip the monthly window but never the ceiling — they are exactly the
 * accounts nothing else bounds.
 */
export async function checkTranslationQuota(ports: QuotaPorts, user: QuotaSubject): Promise<QuotaDecision> {
  const creditCost = 1;
  const planConfig = await ports.settings.getPlanLimit(user.subscriptionPlan);
  const entitlements = resolveEntitlements({
    audienceGroup: user.audienceGroup,
    plan: user.subscriptionPlan,
    planConfig,
    planFeatures: [],
  });

  if (entitlements.translationsPerMonth !== null) {
    const trial = await ports.subscriptions?.findTrialByUser(user.id);
    const windowStart = resolveMeteredWindowStart(getMonthlyWindowStart(), trial?.currentPeriodEnd);
    const usedCredits = await ports.translationRequests.getUserCreditsInWindow(user.id, windowStart);
    if (usedCredits + creditCost > entitlements.translationsPerMonth) {
      return { ok: false, reason: "plan", resetAt: getMonthlyWindowReset() };
    }
  }

  return checkDailyCeiling(ports, user, creditCost);
}

/** The ceiling alone, for a caller that ran its own plan gate. */
export async function checkDailyCeiling(
  ports: QuotaPorts,
  user: QuotaSubject,
  requestedCredits: number,
): Promise<QuotaDecision> {
  const usedCredits = await ports.translationRequests.getUserCreditsInWindow(user.id, getDailyWindowStart());
  const planConfig = isUnlimitedRole(user.audienceGroup)
    ? null
    : await resolvePlanLimit(ports.settings, user.subscriptionPlan);
  return ceilingDecision(usedCredits, requestedCredits, planConfig?.dailyCreditCeiling);
}

/**
 * Per-plan cap on mentor turns per UTC day, on top of the credit meter: the mentor
 * model is priced above the translate default, so the unmetered Plus plan still
 * needs a ceiling on the expensive calls while Pro sells them unlimited. Turns are
 * counted from the ledger's "[mentor]" rows, so a refused or failed turn (never
 * recorded) does not burn the allowance.
 */
export async function checkMentorDailyQuota(
  ports: QuotaPorts,
  user: QuotaSubject,
): Promise<{ ok: true } | { ok: false; limit: number }> {
  if (isUnlimitedRole(user.audienceGroup)) return { ok: true };
  // `?? null`: a legacy fallback table predating the column reads as "no cap",
  // never as "cap of undefined" (which would refuse every turn).
  const limit = (await resolvePlanLimit(ports.settings, user.subscriptionPlan)).mentorDailyLimit ?? null;
  if (limit === null) return { ok: true };
  const used = await ports.translationRequests.countRequestsInWindow(user.id, "[mentor]", getDailyWindowStart());
  return used < limit ? { ok: true } : { ok: false, limit };
}

/**
 * Per-plan cap on grammar checks per UTC day — the only gate the check has: every
 * tier includes it, so the limit stands in for a feature key and `0` is how a plan
 * goes without (`limit: 0` in the refusal). Counted from the ledger's
 * "[grammarCheck]" rows, so a failed check (never recorded) does not burn the allowance.
 */
export async function checkGrammarCheckDailyQuota(
  ports: QuotaPorts,
  user: QuotaSubject,
): Promise<{ ok: true } | { ok: false; limit: number }> {
  if (isUnlimitedRole(user.audienceGroup)) return { ok: true };
  const limit = (await resolvePlanLimit(ports.settings, user.subscriptionPlan)).grammarCheckDailyLimit;
  if (limit === null) return { ok: true };
  // A negative value is the column's "never configured" sentinel, which the deploy
  // backfills before the bot starts; should one slip through, refusing is the cheap
  // mistake — reading it as a number would never refuse anyone.
  if (limit <= 0) return { ok: false, limit: 0 };
  const used = await ports.translationRequests.countRequestsInWindow(user.id, "[grammarCheck]", getDailyWindowStart());
  return used < limit ? { ok: true } : { ok: false, limit };
}

/** Bills a paid AI call into the shared ledger, tagged by call type. */
export async function recordAiUsage(
  ports: Pick<QuotaPorts, "translationRequests">,
  userId: number,
  callType: AiCallType,
  creditCost: number,
  sourceLangCode: string | null = null,
  targetLangCodes: string[] = [],
): Promise<void> {
  await ports.translationRequests.logTranslationRequest(
    userId,
    `[${callType}]`,
    sourceLangCode,
    targetLangCodes,
    creditCost,
  );
}
