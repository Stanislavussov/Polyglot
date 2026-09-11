/**
 * Paid-feature gating for translation cards (Task 79).
 *
 * Two jobs, one rule between them: the badge on a button is cosmetic and the
 * check on the tap is authoritative. Cards outlive plans (Telegram forbids
 * editing a message after 48 h, so a keyboard rendered while the user was on
 * Free stays on screen after they upgrade, and vice versa) — which is exactly
 * why no handler may infer access from the keyboard it was tapped on.
 */
import { ALL_FEATURES, defaultFeatureAccess, type FeatureKey, type SupportedLang } from "@polyglot/core";
import { trackProductEvent } from "../../observability/product-events.js";
import type { BotContext } from "../../types.js";
import { resolveFeatureBadges, sendUpgradeScreen } from "./subscription.helper.js";

/**
 * What resolving locks needs from a context — narrow on purpose so the
 * conversation flavour (`ConversationContext`, used by the regen dialog)
 * satisfies it just as well as a plain update context.
 */
type EntitledContext = Pick<BotContext, "services" | "user">;

/**
 * Feature keys the viewer's plan does NOT include, each with the badge its button
 * should wear — the emoji of the tier that sells it (⭐ Plus, 💎 Pro), so the card
 * points at the same plan the upgrade screen will offer. One plan lookup per card,
 * not one per button, and none at all for a viewer who has everything.
 */
export async function resolveLockedBadges(ctx: EntitledContext): Promise<ReadonlyMap<string, string>> {
  const access = ctx.services.featureAccess ?? defaultFeatureAccess;
  const granted = await access.listFeatures(ctx.user);
  const locked = ALL_FEATURES.filter((key) => !granted.has(key));
  if (locked.length === 0) return new Map();
  return resolveFeatureBadges(ctx, locked);
}

/**
 * Gate a paid card action. Returns `true` when the user may proceed; otherwise
 * answers the callback query and opens the upgrade screen, and the caller must
 * return immediately. The callback answer carries no text on purpose — the plan
 * comparison that follows says everything a toast would have.
 */
export async function ensurePaidFeature(ctx: BotContext, feature: FeatureKey, lang?: SupportedLang): Promise<boolean> {
  return gate(ctx, feature, lang, () => ctx.answerCallbackQuery());
}

/**
 * Same gate for a paid action reached by sending a MESSAGE rather than tapping a
 * button (a voice message, say). There is no callback query to answer — calling
 * `answerCallbackQuery` here would throw — so the upgrade screen is the whole
 * refusal.
 */
export async function ensurePaidFeatureForMessage(
  ctx: BotContext,
  feature: FeatureKey,
  lang?: SupportedLang,
): Promise<boolean> {
  return gate(ctx, feature, lang);
}

async function gate(
  ctx: BotContext,
  feature: FeatureKey,
  lang: SupportedLang | undefined,
  acknowledge?: () => Promise<unknown>,
): Promise<boolean> {
  const access = ctx.services.featureAccess ?? defaultFeatureAccess;
  const { hasAccess } = await access.checkFeatureAccess(ctx.user, feature);
  // Every paid feature is reached through this gate, so counting both outcomes
  // here is what keeps "which features do people use, and which do they bounce
  // off" a single fact rather than one instrumented call site per feature.
  if (hasAccess) {
    trackProductEvent(ctx, "feature.used", feature);
    return true;
  }
  trackProductEvent(ctx, "feature.locked", feature);
  trackProductEvent(ctx, "paywall.shown", feature);
  await acknowledge?.();
  // `lang` is passed by callers that already loaded settings, sparing the upgrade
  // screen a second read of the same row. The feature travels with it so the offer
  // can open by naming the button that just refused.
  await sendUpgradeScreen(ctx, lang, feature);
  return false;
}
