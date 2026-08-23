/**
 * Upgrade screen and (mock) checkout — the presentation half of paid tiers.
 *
 * Everything here is provider-agnostic on purpose: the plans, their prices and
 * their feature lists come from the database, and buying goes through
 * `PaymentPort` (a mock that always succeeds today). The confirmation step below
 * is the placeholder for the future Telegram Stars invoice — when Stars land,
 * `plan:confirm` opens an invoice instead of calling `activate` directly and the
 * rest of this file is unchanged (see `@docs/tech-reqs/16-payments-architecture.md`).
 */
import {
  createSubscriptionService,
  defaultFeatureAccess,
  FEATURE_KEYS,
  type FeatureKey,
  formatLongDate,
  type I18nKey,
  isSupported,
  type PlanLimitConfig,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../../types.js";
import { replyTechnical } from "../../utils/message-cleanup.js";

/**
 * Plan badge for the buy buttons. Deliberately not repeated in the screen's prose:
 * ⭐ there already means "this button is paid", and a Plus header wearing the same
 * star made the reader parse one symbol two ways.
 */
const PLAN_EMOJI: Record<string, string> = { plus: "⭐", pro: "💎" };
const DEFAULT_PLAN_EMOJI = "✨";

/**
 * How a locked feature names itself at the top of the offer. The emoji is the one
 * on the button the user just tapped, so the screen visibly answers that tap; the
 * label is the same bullet the plan block lists, so the promise is worded once.
 */
const FEATURE_HEADLINE: Record<FeatureKey, { emoji: string; label: I18nKey }> = {
  clarification: { emoji: "🎯", label: "planLineClarification" },
  pronunciation: { emoji: "🔊", label: "planLinePronunciation" },
  grammarBreakdown: { emoji: "📖", label: "planLineGrammar" },
  etymology: { emoji: "📖", label: "planLineGrammar" },
  grammarDetail: { emoji: "📖", label: "planLineGrammar" },
  voiceInput: { emoji: "🎙️", label: "featureVoiceInput" },
};

interface PurchasablePlan {
  name: string;
  label: string;
  priceUsdCents: number;
  translationLimit: number | null;
  videoLimit: number | null;
  videoWindow: PlanLimitConfig["videoWindow"];
  features: ReadonlySet<string>;
}

/** CTA shown on a gate (translation/video limit) — opens the plan comparison. */
export function buildUpgradeKeyboard(lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard().text(t("upgradeCta", lang), "plan:upgrade");
}

/** Interface language and timezone in one read — the activation notice renders a date. */
async function resolveDisplaySettings(ctx: BotContext): Promise<{ lang: SupportedLang; timeZone: string }> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return {
    lang: (isSupported(iLang) ? iLang : "en") as SupportedLang,
    timeZone: settings?.timezone || "UTC",
  };
}

async function resolveLang(ctx: BotContext): Promise<SupportedLang> {
  return (await resolveDisplaySettings(ctx)).lang;
}

/**
 * Plans a user can actually buy: active and priced, cheapest first. A plan with
 * no price is not for sale (free, or an internal plan like `unlimited`) — which
 * also keeps a hand-crafted `plan:buy:unlimited` callback from granting anything.
 */
async function loadPurchasablePlans(ctx: BotContext): Promise<PurchasablePlan[]> {
  const access = ctx.services.featureAccess ?? defaultFeatureAccess;
  const priced = (await ctx.services.settings.getPlanLimits())
    .filter((plan): plan is PlanLimitConfig & { priceUsdCents: number } => plan.isActive && plan.priceUsdCents !== null)
    .sort((a, b) => a.priceUsdCents - b.priceUsdCents);

  return Promise.all(
    priced.map(async (plan) => ({
      name: plan.name,
      label: plan.label,
      priceUsdCents: plan.priceUsdCents,
      translationLimit: plan.translationLimit,
      videoLimit: plan.videoLimit,
      videoWindow: plan.videoWindow,
      features: await access.listPlanFeatures(plan.name),
    })),
  );
}

/**
 * Refuse a purchase that would replace a paid plan with the same or a cheaper one,
 * and describe the plan being kept. `activate` cancels the running subscription
 * before opening the new period, so a Pro subscriber tapping "Plus" on an upsell
 * message from last week would pay to lose Pro — and Stars has no proration to
 * give it back. Downgrades belong at period end (tech-req 16 §4.3), which nothing
 * here implements yet. A plan that is not for sale (free, or an internal plan)
 * counts as 0: nothing is lost by leaving it.
 */
async function refuseAsDowngrade(ctx: BotContext, target: PurchasablePlan): Promise<string | null> {
  const current = (await ctx.services.settings.getPlanLimits()).find((plan) => plan.name === ctx.user.subscriptionPlan);
  return (current?.priceUsdCents ?? 0) >= target.priceUsdCents ? (current?.label ?? ctx.user.subscriptionPlan) : null;
}

/** `500` → `$5`, `1050` → `$10.50`. */
function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

function planEmoji(name: string): string {
  return PLAN_EMOJI[name] ?? DEFAULT_PLAN_EMOJI;
}

/** "$5/mo" — one place, so the screen and its buttons can never disagree on a price. */
function planPrice(plan: PurchasablePlan, lang: SupportedLang): string {
  return t("planPricePerMonth", lang, { price: formatPrice(plan.priceUsdCents) });
}

/**
 * What a plan buys, as bullet lines — limits first, then the card features it
 * unlocks.
 *
 * The video line deliberately carries no number. A paid plan's video allowance is
 * a ceiling almost nobody reaches, and printing it turns a feature into a budget
 * the reader starts planning around; what sells the feature is what it produces —
 * a vocabulary list out of a YouTube video. A plan with no video access still
 * shows nothing at all.
 */
function planBullets(plan: PurchasablePlan, lang: SupportedLang): string[] {
  const bullets: string[] = [
    plan.translationLimit === null
      ? t("planLineTranslationsUnlimited", lang)
      : t("planLineTranslations", lang, { count: String(plan.translationLimit) }),
  ];

  if (plan.videoWindow !== "none" && plan.videoLimit !== 0) {
    bullets.push(t("planLineVideo", lang));
  }

  if (plan.features.has(FEATURE_KEYS.clarification)) {
    bullets.push(t("planLineClarification", lang));
  }
  if (plan.features.has(FEATURE_KEYS.pronunciation)) {
    bullets.push(t("planLinePronunciation", lang));
  }
  if (plan.features.has(FEATURE_KEYS.voiceInput)) {
    bullets.push(t("planLineVoiceInput", lang));
  }
  // The three grammar keys are one user-visible promise, so they collapse to one line.
  if (
    plan.features.has(FEATURE_KEYS.grammarBreakdown) ||
    plan.features.has(FEATURE_KEYS.etymology) ||
    plan.features.has(FEATURE_KEYS.grammarDetail)
  ) {
    bullets.push(t("planLineGrammar", lang));
  }

  return bullets;
}

/**
 * The offer opens by naming the thing the user just could not do and the cheapest
 * plan on offer that unlocks it, so the screen reads as an answer to that tap
 * rather than a price list. Without a feature (a limit gate, or the plain
 * `plan:upgrade` CTA) it falls back to the generic prompt, and so does a feature
 * no offered plan carries — promising it under a plan that lacks it would be a lie.
 */
function offerHeadline(offered: PurchasablePlan[], lang: SupportedLang, feature: FeatureKey | undefined): string {
  const headline = feature ? FEATURE_HEADLINE[feature] : undefined;
  const unlocking = feature ? offered.find((plan) => plan.features.has(feature)) : undefined;
  if (!headline || !unlocking) {
    return t("upgradePrompt", lang);
  }
  return t("upgradeFeatureLocked", lang, {
    feature: `${headline.emoji} ${t(headline.label, lang)}`,
    plan: unlocking.label,
  });
}

/**
 * Plans render cheapest-first, and every plan after the first is written as the
 * difference from the one below it: "Everything in Plus" plus the lines that plan
 * does not already have. A reader comparing tiers only wants to know what the
 * extra money buys, and a second full list makes them diff two paragraphs to find
 * out. A tier that adds only a limit increase (nothing new to name) collapses to
 * the inclusion line alone, which is the honest rendering of that tier.
 *
 * `from` hides the rungs the user has already climbed while keeping them as the
 * diff base: a Plus subscriber sees the Pro block alone, still headed "Everything
 * in Plus" — the tier they know — instead of a restated Plus list.
 */
function renderUpgradeScreen(
  ladder: PurchasablePlan[],
  from: number,
  lang: SupportedLang,
  feature?: FeatureKey,
): string {
  const blocks = ladder.slice(from).map((plan, offset) => {
    const header = `<b>${plan.label}</b> — ${planPrice(plan, lang)}`;
    const cheaper = ladder[from + offset - 1];
    const bullets = planBullets(plan, lang);
    const lines = cheaper
      ? [
          t("planLineEverythingIn", lang, { plan: cheaper.label }),
          ...bullets.filter((line) => !planBullets(cheaper, lang).includes(line)),
        ]
      : bullets;
    return [header, ...lines.map((line) => `• ${line}`)].join("\n");
  });

  return [
    offerHeadline(ladder.slice(from), lang, feature),
    ...blocks,
    `<i>${t("upgradeTestPaymentNote", lang)}</i>`,
  ].join("\n\n");
}

function buildPlanChoiceKeyboard(plans: PurchasablePlan[], lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const plan of plans) {
    kb.text(`${planEmoji(plan.name)} ${plan.label} — ${planPrice(plan, lang)}`, `plan:buy:${plan.name}`).row();
  }
  return kb;
}

/** What the user's current plan costs; a plan that is not for sale counts as 0, as in `refuseAsDowngrade`. */
async function currentPlanPrice(ctx: BotContext): Promise<number> {
  const current = (await ctx.services.settings.getPlanLimits()).find((plan) => plan.name === ctx.user.subscriptionPlan);
  return current?.priceUsdCents ?? 0;
}

/**
 * Send the plan comparison. This is the single upsell surface: limit gates and
 * ⭐-badged buttons all land here, so pricing copy lives in exactly one place.
 *
 * Only plans dearer than the current one are offered. `refuseAsDowngrade` turns a
 * tap on the plan the user already has into a refusal, so listing it puts a button
 * on the screen that cannot do anything — and a Plus subscriber reading a Plus
 * block learns nothing about why the tapped button stayed shut.
 */
export async function sendUpgradeScreen(ctx: BotContext, lang?: SupportedLang, feature?: FeatureKey): Promise<void> {
  const iLang = lang ?? (await resolveLang(ctx));
  const ladder = await loadPurchasablePlans(ctx);
  const paidFor = await currentPlanPrice(ctx);
  const from = ladder.findIndex((plan) => plan.priceUsdCents > paidFor);
  if (from === -1) {
    // Nothing left to sell. Two different truths, and neither is an error the user
    // caused: they are at the top of the ladder, or no plan is priced yet (a fresh
    // deployment before the catalog seed). Never a ⚠️ — the user did nothing wrong.
    await replyTechnical(ctx, t(ladder.length > 0 ? "upgradeTopPlan" : "upgradeComingSoon", iLang));
    return;
  }
  await replyTechnical(ctx, renderUpgradeScreen(ladder, from, iLang, feature), {
    parse_mode: "HTML",
    reply_markup: buildPlanChoiceKeyboard(ladder.slice(from), iLang),
  });
}

/** `plan:upgrade` → show the plan comparison with prices. */
export async function handleUpgradePromptCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await sendUpgradeScreen(ctx);
}

/** `plan:buy:<plan>` → confirm first. No money moves yet; this is the test-payment step. */
export async function handleBuyPlanCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const lang = await resolveLang(ctx);

  const name = (ctx.callbackQuery?.data ?? "").split(":")[2];
  const plan = (await loadPurchasablePlans(ctx)).find((candidate) => candidate.name === name);
  if (!plan) {
    await replyTechnical(ctx, t("checkoutFailed", lang));
    return;
  }
  const keptPlan = await refuseAsDowngrade(ctx, plan);
  if (keptPlan) {
    await replyTechnical(ctx, t("purchaseDowngradeBlocked", lang, { plan: keptPlan }), { parse_mode: "HTML" });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(t("purchaseConfirmYes", lang), `plan:confirm:${plan.name}`)
    .text(t("purchaseConfirmNo", lang), "plan:cancel");

  await replyTechnical(
    ctx,
    t("purchaseConfirmPrompt", lang, { plan: plan.label, price: formatPrice(plan.priceUsdCents) }),
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
    },
  );
}

/** `plan:confirm:<plan>` → run the (mock) checkout, upgrade the user, confirm. */
export async function handleConfirmPlanCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const { lang, timeZone } = await resolveDisplaySettings(ctx);

  const name = (ctx.callbackQuery?.data ?? "").split(":")[2];
  // Re-validated against the catalog, not trusted from the callback data: the
  // button is forwardable and the plan could have been unpublished meanwhile.
  const plan = (await loadPurchasablePlans(ctx)).find((candidate) => candidate.name === name);
  const { paymentPort, subscriptionRepository } = ctx.services;
  if (!plan || !paymentPort || !subscriptionRepository) {
    await replyTechnical(ctx, t("checkoutFailed", lang));
    return;
  }
  // Re-checked here too: the confirm button is as forwardable as the buy button,
  // and the plan pointer may have moved since the confirmation was rendered.
  const keptPlan = await refuseAsDowngrade(ctx, plan);
  if (keptPlan) {
    await replyTechnical(ctx, t("purchaseDowngradeBlocked", lang, { plan: keptPlan }), { parse_mode: "HTML" });
    return;
  }

  const service = createSubscriptionService({
    payment: paymentPort,
    subscriptions: subscriptionRepository,
    users: ctx.services.userRepository,
  });

  const result = await service.activate(ctx.user.id, plan.name);
  if (!result.ok || !result.currentPeriodEnd) {
    await replyTechnical(ctx, t("checkoutFailed", lang));
    return;
  }

  const date = formatLongDate(result.currentPeriodEnd, lang, timeZone);
  await replyTechnical(ctx, t("subscriptionActivated", lang, { plan: plan.label, date }));
}

/** `plan:cancel` → back out of the test payment without touching anything. */
export async function handleCancelPlanCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const lang = await resolveLang(ctx);
  await replyTechnical(ctx, t("purchaseCanceled", lang));
}
