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
import type { BotContext } from "../../types.js";
import { sendUpgradeScreen } from "./subscription.helper.js";

/**
 * What resolving locks needs from a context — narrow on purpose so the
 * conversation flavour (`ConversationContext`, used by the regen dialog)
 * satisfies it just as well as a plain update context.
 */
type EntitledContext = Pick<BotContext, "services" | "user">;

/**
 * Feature keys the viewer's plan does NOT include — the set the card renderer
 * badges with ⭐. One plan lookup per card, not one per button.
 */
export async function resolveLockedFeatures(ctx: EntitledContext): Promise<ReadonlySet<string>> {
  const access = ctx.services.featureAccess ?? defaultFeatureAccess;
  const granted = await access.listFeatures(ctx.user);
  return new Set(ALL_FEATURES.filter((key) => !granted.has(key)));
}

/**
 * Gate a paid card action. Returns `true` when the user may proceed; otherwise
 * answers the callback query and opens the upgrade screen, and the caller must
 * return immediately. The callback answer carries no text on purpose — the plan
 * comparison that follows says everything a toast would have.
 */
export async function ensurePaidFeature(ctx: BotContext, feature: FeatureKey, lang?: SupportedLang): Promise<boolean> {
  const access = ctx.services.featureAccess ?? defaultFeatureAccess;
  const { hasAccess } = await access.checkFeatureAccess(ctx.user, feature);
  if (hasAccess) {
    return true;
  }
  await ctx.answerCallbackQuery();
  // `lang` is passed by callers that already loaded settings, sparing the upgrade
  // screen a second read of the same row. The feature travels with it so the offer
  // can open by naming the button that just refused.
  await sendUpgradeScreen(ctx, lang, feature);
  return false;
}
