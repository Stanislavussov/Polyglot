import {
  evaluatePlanRateLimit,
  getDailyWindowReset,
  getDailyWindowStart,
  type SubscriptionPlan,
  type SupportedLang,
  t,
} from "@polyglot/core";
import type { BotContext } from "../types.js";
import { resolvePlanLimit } from "./plan-limit.js";

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
  grammar: 1,
  etymology: 1,
} as const;

export type AiCallType = keyof typeof AI_CALL_WEIGHTS;

/**
 * The single credit-metering point for every paid AI call. Checks the user's
 * remaining daily quota against a call of the given type's weight. On success
 * it returns the credit cost to record; when the quota is exhausted it replies
 * with the rate-limit notice and returns null (the caller must then abort).
 */
export async function ensureAiQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
  callType: AiCallType,
): Promise<number | null> {
  const weight = AI_CALL_WEIGHTS[callType];
  const windowStart = getDailyWindowStart();
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(ctx.user.id, windowStart);
  const planLimit = await resolvePlanLimit(ctx.services.settings, plan);
  // A plan sets its own per-request base cost; multiply by the call weight so
  // heavier calls still cost proportionally more under any plan.
  const requestedCredits = planLimit.creditCost * weight;

  const status = evaluatePlanRateLimit(
    { plan: planLimit.name, label: planLimit.label, creditsPerDay: planLimit.creditsPerDay },
    usedCredits,
    requestedCredits,
    getDailyWindowReset(),
  );

  if (!status.allowed) {
    await ctx.reply(t("rateLimitExceeded", lang));
    return null;
  }

  return requestedCredits;
}

/**
 * Record consumption of `creditCost` credits for a paid AI call in the shared
 * ledger (the same table the translate flow bills against), tagged by call type.
 */
export async function recordAiUsage(
  ctx: BotContext,
  callType: AiCallType,
  creditCost: number,
  sourceLangCode: string | null = null,
  targetLangCodes: string[] = [],
): Promise<void> {
  await ctx.services.translationRequestRepository.logTranslationRequest(
    ctx.user.id,
    `[${callType}]`,
    sourceLangCode,
    targetLangCodes,
    creditCost,
  );
}
