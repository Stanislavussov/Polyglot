import {
  evaluateDailyCeiling,
  evaluatePlanRateLimit,
  getDailyWindowReset,
  getDailyWindowStart,
  isUnlimitedRole,
  logEvent,
  type SubscriptionPlan,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { trackProductEvent } from "../observability/product-events.js";
import { buildUpgradeKeyboard } from "../scenes/helpers/subscription.helper.js";
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
  wordPick: 3,
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
  // An internal role bypasses every plan limit (`resolveEntitlements`), and the
  // mentor's own daily cap already honours that; this meter did not, so a tester
  // on the default plan was capped on every other paid call. The safety ceiling
  // below is the one limit they do NOT bypass. The caller still bills the ledger
  // — the call costs real money and the admin reports read it — at the bare call
  // weight, since skipping the plan read means no per-request cost is known
  // (identical while every plan charges 1).
  const internal = isUnlimitedRole(ctx.user.audienceGroup);
  const windowStart = getDailyWindowStart();
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(ctx.user.id, windowStart);
  const planLimit = internal ? null : await resolvePlanLimit(ctx.services.settings, plan);
  // A plan sets its own per-request base cost; multiply by the call weight so
  // heavier calls still cost proportionally more under any plan.
  const requestedCredits = planLimit ? planLimit.creditCost * weight : weight;

  if (planLimit) {
    const status = evaluatePlanRateLimit(
      { plan: planLimit.name, label: planLimit.label, creditsPerDay: planLimit.translationLimit },
      usedCredits,
      requestedCredits,
      getDailyWindowReset(),
    );

    if (!status.allowed) {
      // Same message and same way out as the translate-flow quota gate: an exhausted
      // quota is the moment the upgrade offer is worth something, and a bare notice
      // here would be the one dead end left in the funnel.
      trackProductEvent(ctx, "limit.reached", "translation");
      await ctx.reply(t("rateLimitExceeded", lang), { reply_markup: buildUpgradeKeyboard(lang) });
      return null;
    }
  }

  if (!(await ensureDailyCeiling(ctx, usedCredits, requestedCredits, planLimit?.dailyCreditCeiling, lang, callType))) {
    return null;
  }

  return requestedCredits;
}

/**
 * The ceiling nobody is exempt from — the last check before a paid call, after
 * whatever the plan itself had to say.
 *
 * Ordered last on purpose: a metered plan that has run out should meet its own
 * limit and the upgrade offer, not this one. Reaching this check at all means
 * the plan was willing, so the refusal has nothing to sell and says so — it is
 * an ops guard tripping, and the only honest thing to report is that today's use
 * is far past what a person does and when it resets.
 */
async function ensureDailyCeiling(
  ctx: BotContext,
  usedCredits: number,
  requestedCredits: number,
  planCeiling: number | null | undefined,
  lang: SupportedLang,
  callType: AiCallType | "translate",
): Promise<boolean> {
  const status = evaluateDailyCeiling(usedCredits, requestedCredits, planCeiling);
  if (status.allowed) {
    return true;
  }
  // Warn, not info: this should be rare enough that every occurrence is worth a
  // look, and silent enforcement would make a stuck client indistinguishable
  // from a quiet day.
  logEvent(
    "limit.daily_ceiling_reached",
    {
      userId: ctx.user.id,
      plan: ctx.user.subscriptionPlan,
      audienceGroup: ctx.user.audienceGroup,
      callType,
      ceiling: status.ceiling,
      usedCredits: status.usedCredits,
    },
    "warn",
  );
  trackProductEvent(ctx, "limit.reached", "daily_ceiling");
  await ctx.reply(t("dailyCeilingReached", lang, { resetsAt: formatResetTime(getDailyWindowReset()) }));
  return false;
}

/** "14:05 UTC" — the window is a rolling 24 h, so a clock time is the only honest answer. */
function formatResetTime(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/**
 * The same ceiling for the translate path, which runs its own monthly quota gate
 * and never reaches {@link ensureAiQuota}. Exported so there is exactly one
 * implementation of "no account is uncapped" rather than two that can drift.
 */
export async function ensureTranslationDailyCeiling(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
  requestedCredits: number,
): Promise<boolean> {
  // Read unconditionally, including for internal roles and unlimited plans —
  // those are precisely the accounts nothing else bounds. One indexed aggregate
  // is noise beside the multi-second AI call it guards.
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(
    ctx.user.id,
    getDailyWindowStart(),
  );
  const planConfig = isUnlimitedRole(ctx.user.audienceGroup)
    ? null
    : await resolvePlanLimit(ctx.services.settings, plan);
  return ensureDailyCeiling(ctx, usedCredits, requestedCredits, planConfig?.dailyCreditCeiling, lang, "translate");
}

/**
 * Per-plan cap on mentor turns per UTC day, on top of the credit meter: the
 * mentor model is priced above the translate default, so the unmetered Plus
 * plan still needs a ceiling on the expensive calls while Pro sells them
 * unlimited. Turns are counted from the shared ledger's "[mentor]" rows, so a
 * refused or failed turn (never recorded) does not burn the allowance.
 * Returns true when the turn may proceed; otherwise replies with the limit
 * notice + upgrade offer and returns false.
 */
export async function ensureMentorDailyQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
): Promise<boolean> {
  // Internal roles bypass every plan limit (same rule as resolveEntitlements).
  if (isUnlimitedRole(ctx.user.audienceGroup)) {
    return true;
  }
  const planLimit = await resolvePlanLimit(ctx.services.settings, plan);
  // `?? null`: a legacy fallback table predating the column reads as "no cap",
  // never as "cap of undefined" (which would refuse every turn).
  const limit = planLimit.mentorDailyLimit ?? null;
  if (limit === null) {
    return true;
  }
  const used = await ctx.services.translationRequestRepository.countRequestsInWindow(
    ctx.user.id,
    "[mentor]",
    getDailyWindowStart(),
  );
  if (used < limit) {
    return true;
  }
  trackProductEvent(ctx, "limit.reached", "mentor");
  await ctx.reply(t("mentorDailyLimitReached", lang, { limit: String(limit) }), {
    reply_markup: buildUpgradeKeyboard(lang),
  });
  return false;
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
