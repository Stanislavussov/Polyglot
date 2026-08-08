import { createSubscriptionService, isSupported, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../../types.js";
import { replyTechnical } from "../../utils/message-cleanup.js";

const PLAN_LABELS: Record<string, string> = { plus: "Plus", pro: "Pro" };

/** CTA shown on a gate (translation/video limit) — opens the plan comparison. */
export function buildUpgradeKeyboard(lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard().text(t("upgradeCta", lang), "plan:upgrade");
}

/** Plan picker shown on the comparison screen. */
export function buildPlanChoiceKeyboard(lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard().text(t("upgradePlus", lang), "plan:buy:plus").text(t("upgradePro", lang), "plan:buy:pro");
}

async function resolveLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return (isSupported(iLang) ? iLang : "en") as SupportedLang;
}

/** `plan:upgrade` → show the Free/Plus/Pro comparison with a plan picker. */
export async function handleUpgradePromptCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const lang = await resolveLang(ctx);
  await replyTechnical(ctx, t("upgradePrompt", lang), {
    parse_mode: "HTML",
    reply_markup: buildPlanChoiceKeyboard(lang),
  });
}

/** `plan:buy:<plan>` → run the (mock) checkout, upgrade the user, confirm. */
export async function handleBuyPlanCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const lang = await resolveLang(ctx);

  const plan = (ctx.callbackQuery?.data ?? "").split(":")[2];
  if (plan !== "plus" && plan !== "pro") return;

  const { paymentPort, subscriptionRepository } = ctx.services;
  if (!paymentPort || !subscriptionRepository) return;

  const service = createSubscriptionService({
    payment: paymentPort,
    subscriptions: subscriptionRepository,
    users: ctx.services.userRepository,
  });

  const result = await service.activate(ctx.user.id, plan);
  if (!result.ok || !result.currentPeriodEnd) {
    await replyTechnical(ctx, t("checkoutFailed", lang));
    return;
  }

  const date = result.currentPeriodEnd.toISOString().slice(0, 10);
  await replyTechnical(ctx, t("subscriptionActivated", lang, { plan: PLAN_LABELS[plan] ?? plan, date }));
}
