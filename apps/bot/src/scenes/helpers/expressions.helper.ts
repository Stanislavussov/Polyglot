import {
  type GeneratedExpression,
  generateExpression,
  isSupported,
  logger,
  type SupportedLang,
  t,
  type UserLanguageSettings,
} from "@polyglot/core";
import { keyboardWithoutTappedButton, nudgedWord } from "../../notifications/notification.callbacks.js";
import { buildExpressionHubKeyboard, formatExpressionCard } from "../../renderers/expression.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { ensureAiQuota, recordAiUsage } from "../../utils/ai-quota.js";
import { editMessageReplyMarkupOrIgnore } from "./edit-message.helper.js";

function interfaceLang(settings: UserLanguageSettings | null): SupportedLang {
  const iLang = settings?.interfaceLang ?? "en";
  return isSupported(iLang) ? iLang : "en";
}

async function dropNotice(ctx: BotContext, messageId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(ctx.chat?.id ?? 0, messageId);
  } catch {
    // A leftover "finding…" line is cosmetic.
  }
}

async function showExpression(ctx: BotContext, settings: UserLanguageSettings | null, avoid: string[]): Promise<void> {
  const lang = interfaceLang(settings);
  const creditCost = await ensureAiQuota(ctx, ctx.user.subscriptionPlan, lang, "expression");
  if (creditCost === null) return;

  const nativeLang = settings?.nativeLang ?? "en";
  const notice = await ctx.reply(t("exprGenerating", lang));

  let expression: GeneratedExpression;
  try {
    const model = await resolveDefaultAIModel(ctx.services.settings, ctx.user.subscriptionPlan);
    expression = await generateExpression(
      {
        userId: ctx.user.id,
        nativeLang,
        learningLangs: settings?.learningLangs ?? [],
        // On demand there is no slot to stay stable for, so every tap rolls a new angle.
        seed: Math.floor(Math.random() * 2 ** 31),
        avoid,
      },
      { generateObjectFn: ctx.services.ai.generateObject, modelId: model },
    );
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Expression generation failed");
    await dropNotice(ctx, notice.message_id);
    await ctx.reply(t("exprFailed", lang));
    return;
  }

  await recordAiUsage(ctx, "expression", creditCost, expression.lang, [nativeLang]);
  await dropNotice(ctx, notice.message_id);
  await ctx.reply(formatExpressionCard(expression, lang), {
    parse_mode: "HTML",
    reply_markup: buildExpressionHubKeyboard(lang),
  });
}

/** Learn hub → 💬 Expressions. */
export async function handleExpressionsCommand(ctx: BotContext): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  await showExpression(ctx, settings, []);
}

/**
 * `expr:more` — the next expression. The tapped card loses its 🔁, so an old card
 * cannot spend another AI call; its save button stays.
 */
export async function handleExpressionMoreCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const previous = nudgedWord(ctx);
  await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: keyboardWithoutTappedButton(ctx) } });
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  await showExpression(ctx, settings, previous ? [previous] : []);
}
