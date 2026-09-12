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
  isTrial,
  type PlanLimitConfig,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { trackProductEvent } from "../../observability/product-events.js";
import type { BotContext } from "../../types.js";

/**
 * Plan badge — one glyph per tier, used everywhere a plan is named: the buy
 * buttons here and the badge a locked card button wears (see
 * {@link resolveFeatureBadges}). The two must never diverge: a ⭐ on a button the
 * upgrade screen then sells under 💎 Pro is a promise the screen takes back.
 */
const PLAN_EMOJI: Record<string, string> = { plus: "⭐", pro: "💎" };
const DEFAULT_PLAN_EMOJI = "✨";

/**
 * The bullet a feature is sold under — the same line the plan block lists, so the
 * headline, the marked bullet and the badge all name one promise. `emoji` is the
 * glyph on the button the user just tapped, omitted where the bullet already
 * carries its own.
 *
 * Partial on purpose: `grammarBreakdown` and `grammarDetail` outlived the buttons
 * they gated (they stay in the enum because production plan rows list them), and
 * a bullet for a feature nothing can lock would sell what no plan delivers. A key
 * with no entry falls through to the generic prompt.
 */
const FEATURE_BULLET: Partial<Record<FeatureKey, { emoji?: string; label: I18nKey }>> = {
  clarification: { emoji: "🎯", label: "planLineClarification" },
  pronunciation: { emoji: "🔊", label: "planLinePronunciation" },
  etymology: { emoji: "🔍", label: "planLineEtymology" },
  voiceInput: { label: "planLineVoiceInput" },
  mentor: { emoji: "🧑‍🏫", label: "planLineMentor" },
};

/** All a plan lookup needs — narrow so a conversation context satisfies it too. */
type PlanReadingContext = Pick<BotContext, "services">;

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
async function loadPurchasablePlans(ctx: PlanReadingContext): Promise<PurchasablePlan[]> {
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
 * The badge each of `features` wears when locked: the emoji of the cheapest plan
 * on sale that unlocks it. A Pro-only button badged ⭐ promised Plus and then
 * opened a screen selling Pro, so the glyph now comes from the same plan the
 * offer will name. A feature no plan on sale carries falls back to the neutral
 * badge — it is still locked, it just has no tier to point at.
 */
export async function resolveFeatureBadges(
  ctx: PlanReadingContext,
  features: readonly string[],
): Promise<Map<string, string>> {
  const ladder = await loadPurchasablePlans(ctx);
  return new Map(
    features.map((feature) => {
      const unlocking = ladder.find((plan) => plan.features.has(feature));
      return [feature, unlocking ? planEmoji(unlocking.name) : DEFAULT_PLAN_EMOJI];
    }),
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
  if ((await currentPlanPrice(ctx)) < target.priceUsdCents) {
    return null;
  }
  const current = (await ctx.services.settings.getPlanLimits()).find((plan) => plan.name === ctx.user.subscriptionPlan);
  return current?.label ?? ctx.user.subscriptionPlan;
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
  if (plan.features.has(FEATURE_KEYS.mentor)) {
    bullets.push(t("planLineMentor", lang));
  }
  if (plan.features.has(FEATURE_KEYS.etymology)) {
    bullets.push(t("planLineEtymology", lang));
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
  const bullet = feature ? FEATURE_BULLET[feature] : undefined;
  const unlocking = feature ? offered.find((plan) => plan.features.has(feature)) : undefined;
  if (!bullet || !unlocking) {
    return t("upgradePrompt", lang);
  }
  const name = t(bullet.label, lang);
  return t("upgradeFeatureLocked", lang, {
    feature: bullet.emoji ? `${bullet.emoji} ${name}` : name,
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
 *
 * Every block is headed by its plan's glyph — the same ⭐/💎 the buy button below
 * wears — so a reader pairs a block with the button that buys it by sight.
 *
 * The line that answers the tap is set in bold where it appears. Because the
 * blocks are diffs, that is the cheapest plan granting it and nowhere else — so a
 * reader looking at two priced blocks can see which one their button is in,
 * rather than matching a plan name from the headline against two bullet lists.
 */
function renderUpgradeScreen(
  ladder: PurchasablePlan[],
  from: number,
  lang: SupportedLang,
  feature?: FeatureKey,
): string {
  const wantedBullet = feature ? FEATURE_BULLET[feature] : undefined;
  const wanted = wantedBullet ? t(wantedBullet.label, lang) : undefined;
  const blocks = ladder.slice(from).map((plan, offset) => {
    const header = `${planEmoji(plan.name)} <b>${plan.label}</b> — ${planPrice(plan, lang)}`;
    const cheaper = ladder[from + offset - 1];
    const bullets = planBullets(plan, lang);
    const lines = cheaper
      ? [
          t("planLineEverythingIn", lang, { plan: cheaper.label }),
          ...bullets.filter((line) => !planBullets(cheaper, lang).includes(line)),
        ]
      : bullets;
    const render = (line: string) => `• ${line === wanted ? `<b>${line}</b>` : line}`;
    return [header, ...lines.map(render)].join("\n");
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

/**
 * What the user's current plan costs *them* — the rung of the ladder they have
 * actually climbed.
 *
 * A plan that is not for sale counts as 0, and so does a plan held by the
 * onboarding trial (Task 84). The trial is a gift, not a purchase: priced at its
 * face value it would put the trialling user above the tier they are trialling,
 * and the plan comparison would then hide Plus and refuse a tap on it as a
 * downgrade — refusing the single conversion the reverse trial exists to produce.
 */
async function currentPlanPrice(ctx: BotContext): Promise<number> {
  const active = await ctx.services.subscriptionRepository?.findActiveByUser(ctx.user.id);
  if (active && isTrial(active)) {
    return 0;
  }
  const current = (await ctx.services.settings.getPlanLimits()).find((plan) => plan.name === ctx.user.subscriptionPlan);
  return current?.priceUsdCents ?? 0;
}

/**
 * Send the plan comparison. This is the single upsell surface: limit gates and
 * badged card buttons all land here, so pricing copy lives in exactly one place.
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
    await ctx.reply(t(ladder.length > 0 ? "upgradeTopPlan" : "upgradeComingSoon", iLang));
    return;
  }
  await ctx.reply(renderUpgradeScreen(ladder, from, iLang, feature), {
    parse_mode: "HTML",
    reply_markup: buildPlanChoiceKeyboard(ladder.slice(from), iLang),
  });
}

/** `plan:upgrade` → show the plan comparison with prices. */
export async function handleUpgradePromptCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  // `cta` rather than a feature key: this button is the one on a limit notice
  // and on the /settings menu, neither of which refused a specific feature.
  trackProductEvent(ctx, "paywall.shown", "cta");
  await sendUpgradeScreen(ctx);
}

/** `plan:buy:<plan>` → confirm first. No money moves yet; this is the test-payment step. */
export async function handleBuyPlanCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const lang = await resolveLang(ctx);

  const name = (ctx.callbackQuery?.data ?? "").split(":")[2];
  const plan = (await loadPurchasablePlans(ctx)).find((candidate) => candidate.name === name);
  if (!plan) {
    await ctx.reply(t("checkoutFailed", lang));
    return;
  }
  const keptPlan = await refuseAsDowngrade(ctx, plan);
  if (keptPlan) {
    trackProductEvent(ctx, "plan.downgrade_blocked", plan.name);
    await ctx.reply(t("purchaseDowngradeBlocked", lang, { plan: keptPlan }), { parse_mode: "HTML" });
    return;
  }
  trackProductEvent(ctx, "plan.selected", plan.name);

  const keyboard = new InlineKeyboard()
    .text(t("purchaseConfirmYes", lang), `plan:confirm:${plan.name}`)
    .text(t("purchaseConfirmNo", lang), "plan:cancel");

  await ctx.reply(t("purchaseConfirmPrompt", lang, { plan: plan.label, price: formatPrice(plan.priceUsdCents) }), {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
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
    await ctx.reply(t("checkoutFailed", lang));
    return;
  }
  // Re-checked here too: the confirm button is as forwardable as the buy button,
  // and the plan pointer may have moved since the confirmation was rendered.
  const keptPlan = await refuseAsDowngrade(ctx, plan);
  if (keptPlan) {
    trackProductEvent(ctx, "plan.downgrade_blocked", plan.name);
    await ctx.reply(t("purchaseDowngradeBlocked", lang, { plan: keptPlan }), { parse_mode: "HTML" });
    return;
  }

  const service = createSubscriptionService({
    payment: paymentPort,
    subscriptions: subscriptionRepository,
    users: ctx.services.userRepository,
  });

  const result = await service.activate(ctx.user.id, plan.name);
  if (!result.ok || !result.currentPeriodEnd) {
    await ctx.reply(t("checkoutFailed", lang));
    return;
  }

  // `ctx.user.subscriptionPlan` is still the plan they were ON when they decided
  // to buy — the row the funnel needs, and the reason this is recorded before the
  // confirmation rather than after a refreshed read.
  trackProductEvent(ctx, "plan.confirmed", plan.name);

  const date = formatLongDate(result.currentPeriodEnd, lang, timeZone);
  await ctx.reply(t("subscriptionActivated", lang, { plan: plan.label, date }));
}

/** `plan:cancel` → back out of the test payment without touching anything. */
export async function handleCancelPlanCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  trackProductEvent(ctx, "plan.canceled");
  const lang = await resolveLang(ctx);
  await ctx.reply(t("purchaseCanceled", lang));
}
