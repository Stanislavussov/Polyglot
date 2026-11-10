import {
  type AiCallType,
  buildQuotaPorts,
  checkAiQuota,
  checkGrammarCheckDailyQuota,
  checkMentorDailyQuota,
  checkTranslationQuota,
  recordAiUsage as coreRecordAiUsage,
  getDailyWindowReset,
  logEvent,
  type QuotaDecision,
  type QuotaPorts,
  type SubscriptionPlan,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { trackProductEvent } from "../observability/product-events.js";
import { buildUpgradeKeyboard } from "../scenes/helpers/subscription.helper.js";
import type { BotContext } from "../types.js";

export type { AiCallType };

function quotaPorts(ctx: BotContext): QuotaPorts {
  return buildQuotaPorts(ctx.services);
}

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
  const decision = await checkAiQuota(
    quotaPorts(ctx),
    { id: ctx.user.id, audienceGroup: ctx.user.audienceGroup, subscriptionPlan: plan },
    callType,
  );
  if (decision.ok) return decision.creditCost;
  await replyToRefusal(ctx, decision, lang, callType);
  return null;
}

/**
 * The ceiling nobody is exempt from is checked last: a metered plan that has run
 * out meets its own limit and the upgrade offer, not this one. Reaching the
 * ceiling means the plan was willing, so that refusal has nothing to sell — it is
 * an ops guard tripping, and it only says when the window resets.
 */
async function replyToRefusal(
  ctx: BotContext,
  decision: Extract<QuotaDecision, { ok: false }>,
  lang: SupportedLang,
  callType: AiCallType | "translate",
): Promise<void> {
  if (decision.reason === "plan") {
    // Same message and way out as the translate-flow gate: an exhausted quota is
    // the moment the upgrade offer is worth something.
    trackProductEvent(ctx, "limit.reached", "translation");
    await ctx.reply(t("rateLimitExceeded", lang), { reply_markup: buildUpgradeKeyboard(lang) });
    return;
  }
  // Warn, not info: rare enough that every occurrence is worth a look.
  logEvent(
    "limit.daily_ceiling_reached",
    {
      userId: ctx.user.id,
      plan: ctx.user.subscriptionPlan,
      audienceGroup: ctx.user.audienceGroup,
      callType,
      ceiling: decision.ceiling,
      usedCredits: decision.usedCredits,
    },
    "warn",
  );
  trackProductEvent(ctx, "limit.reached", "daily_ceiling");
  await ctx.reply(t("dailyCeilingReached", lang, { resetsAt: formatResetTime(getDailyWindowReset()) }));
}

/** "14:05 UTC" — the window is a rolling 24 h, so a clock time is the only honest answer. */
function formatResetTime(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/**
 * Translation quota — a monthly (calendar-UTC) window, distinct from the daily
 * credit meter of {@link ensureAiQuota}, then the daily safety ceiling. Returns
 * the credit cost to log, or null after replying with the refusal (the caller
 * must abort). The decision is shared with the web app via core.
 */
export async function ensureTranslationQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
): Promise<number | null> {
  const decision = await checkTranslationQuota(quotaPorts(ctx), {
    id: ctx.user.id,
    audienceGroup: ctx.user.audienceGroup,
    subscriptionPlan: plan,
  });
  if (decision.ok) return decision.creditCost;
  await replyToRefusal(ctx, decision, lang, "translate");
  return null;
}

/**
 * The per-plan daily mentor cap (decided in core, shared with the web app).
 * Returns true when the turn may proceed; otherwise replies with the limit
 * notice + upgrade offer and returns false.
 */
export async function ensureMentorDailyQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
): Promise<boolean> {
  const decision = await checkMentorDailyQuota(quotaPorts(ctx), {
    id: ctx.user.id,
    audienceGroup: ctx.user.audienceGroup,
    subscriptionPlan: plan,
  });
  if (decision.ok) return true;
  trackProductEvent(ctx, "limit.reached", "mentor");
  await ctx.reply(t("mentorDailyLimitReached", lang, { limit: String(decision.limit) }), {
    reply_markup: buildUpgradeKeyboard(lang),
  });
  return false;
}

/** The per-plan daily grammar-check cap (decided in core, shared with the web app); replies on refusal. */
export async function ensureGrammarCheckDailyQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
): Promise<boolean> {
  const decision = await checkGrammarCheckDailyQuota(quotaPorts(ctx), {
    id: ctx.user.id,
    audienceGroup: ctx.user.audienceGroup,
    subscriptionPlan: plan,
  });
  if (decision.ok) return true;
  trackProductEvent(ctx, "limit.reached", "grammar_check");
  const text =
    decision.limit > 0
      ? t("grammarCheckDailyLimitReached", lang, { limit: String(decision.limit) })
      : t("grammarCheckNotInPlan", lang);
  await ctx.reply(text, { reply_markup: buildUpgradeKeyboard(lang) });
  return false;
}

/** Bills a paid AI call into the shared ledger (the one the translate flow bills against). */
export async function recordAiUsage(
  ctx: BotContext,
  callType: AiCallType,
  creditCost: number,
  sourceLangCode: string | null = null,
  targetLangCodes: string[] = [],
): Promise<void> {
  await coreRecordAiUsage(quotaPorts(ctx), ctx.user.id, callType, creditCost, sourceLangCode, targetLangCodes);
}
