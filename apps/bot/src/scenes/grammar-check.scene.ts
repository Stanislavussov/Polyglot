/**
 * Grammar check scene — `/check` and the ✍️ hot button enter the mode.
 *
 * Every tier has the check; the plan's daily limit is the only gate, so the
 * entry refuses with the same limit notice a spent turn would get.
 */
import { isSupported, type SupportedLang, t } from "@polyglot/core";
import { getRequestSettings } from "../middlewares/request-settings.js";
import { trackProductEvent } from "../observability/product-events.js";
import type { BotContext } from "../types.js";
import { ensureGrammarCheckDailyQuota } from "../utils/ai-quota.js";
import { grammarExitKeyboard } from "./helpers/grammar-check.helper.js";

export async function handleGrammarCheckCommand(ctx: BotContext): Promise<void> {
  const settings = await getRequestSettings(ctx, ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(iLang) ? iLang : "en";

  // Gate BEFORE touching the mode: a plan without checks, or a spent day, must
  // not leave the user in a mode where every message answers with a refusal.
  if (!(await ensureGrammarCheckDailyQuota(ctx, ctx.user.subscriptionPlan, lang))) {
    return;
  }

  ctx.session.activeMode = "grammar";
  await ctx.services.userRepository.updateActiveMode(ctx.user.id, "grammar");
  trackProductEvent(ctx, "mode.switched", "grammar");
  // A message held by the mentor's idle prompt belongs to a mode the user just left.
  ctx.session.mentorIdlePrompt = undefined;

  await ctx.reply(t("grammarCheckModeOn", lang), { reply_markup: grammarExitKeyboard(lang) });
}
