/**
 * Grammar check mode — every text the user sends while `activeMode === "grammar"`
 * is checked, and the answer lists each mistake with its rule and an example.
 *
 * The model returns structured data and this file owns the wording: labels come
 * from i18n, the model's strings are escaped, so a model that slips markup into a
 * field can never break the Telegram HTML send.
 */
import {
  checkGrammar,
  errorFields,
  GRAMMAR_CATEGORY_KEYS,
  GRAMMAR_CHECK_MAX_TOKENS,
  GRAMMAR_MAX_INPUT_LENGTH,
  type GrammarCheckOutcome,
  isSupported,
  logEvent,
  resolveMentorModels,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { GrammyError } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { grammarCheckCounter, grammarCheckDuration } from "../../metrics.js";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import { esc } from "../../renderers/card-sections.js";
import type { BotContext } from "../../types.js";
import { buildAiFailover } from "../../utils/ai-model.js";
import { ensureAiQuota, ensureGrammarCheckDailyQuota, recordAiUsage } from "../../utils/ai-quota.js";
import {
  dismissLoader,
  isUserFacingTimeout,
  LONG_OP_TIMEOUT_MS,
  sendLoader,
  sendTypingIndicator,
  withTimeout,
} from "../../utils/long-op.js";
import { replyWithRetry } from "../../utils/retry-action.js";
import { activateTranslateMode } from "../translate.scene.js";

export const GRAMMAR_EXIT_CALLBACK = "grammar:exit";

/** Telegram's limit is 4096; the margin absorbs the "and N more" line. */
const MAX_REPLY_LENGTH = 3900;

export function grammarExitKeyboard(lang: SupportedLang): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: t("grammarCheckExitButton", lang), callback_data: GRAMMAR_EXIT_CALLBACK }]] };
}

type CheckedOutcome = Extract<GrammarCheckOutcome, { status: "checked" }>;

/** The check as Telegram HTML, every model-written string escaped. */
export function renderGrammarCheck(outcome: CheckedOutcome, lang: SupportedLang): string {
  if (outcome.errors.length === 0) {
    const lines = [t("grammarCheckCorrect", lang)];
    if (outcome.naturalAlternative) {
      lines.push("", t("grammarCheckNaturalAlternative", lang), `<i>${esc(outcome.naturalAlternative)}</i>`);
    }
    return lines.join("\n");
  }

  const corrected = [t("grammarCheckCorrected", lang), esc(outcome.correctedText)].join("\n");
  const header = t("grammarCheckIssuesHeader", lang);
  const blocks: string[] = [];
  let length = header.length + corrected.length;
  for (const [index, issue] of outcome.errors.entries()) {
    const block = [
      `${index + 1}. <s>${esc(issue.fragment)}</s> → <b>${esc(issue.correction)}</b>`,
      `🏷 ${t(GRAMMAR_CATEGORY_KEYS[issue.category], lang)}`,
      `${t("grammarCheckWhyLabel", lang)} ${esc(issue.explanation)}`,
      `${t("grammarCheckExampleLabel", lang)} <i>${esc(issue.example)}</i>`,
    ].join("\n");
    // Cut whole issues, never mid-tag: a truncated HTML string fails the send.
    if (length + block.length + 2 > MAX_REPLY_LENGTH) break;
    blocks.push(block);
    length += block.length + 2;
  }
  const hidden = outcome.errors.length - blocks.length;
  if (hidden > 0) blocks.push(t("grammarCheckMoreIssues", lang, { count: hidden }));

  return [header, blocks.join("\n\n"), corrected].join("\n\n");
}

/**
 * A refused turn inside the mode would repeat on every later message, and the
 * refusal carries the upgrade offer, not the exit button — so the user is handed
 * back to translation, which is told in a line of its own.
 */
async function leaveSpentMode(ctx: BotContext): Promise<void> {
  if (ctx.session.activeMode !== "grammar") return;
  const { lang, fromLang, toLangs } = await activateTranslateMode(ctx);
  await ctx.reply(t("translateModeReturned", lang, { fromLang, toLangs }));
}

function isEntityParseError(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 400 && /can't parse entities/i.test(err.description);
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/**
 * Sends the rendered check. Never throws: by now the check is billed and counted,
 * so a send failure must not reach the turn's error path (a second metric, and an
 * "❌ couldn't check" for a check that happened). Escaped content should always
 * parse; the plain resend covers a locale string with broken markup only.
 */
async function replyHtmlOrPlain(ctx: BotContext, html: string, extra: { reply_markup: InlineKeyboardMarkup }) {
  try {
    await ctx.reply(html, { ...extra, parse_mode: "HTML" });
    return;
  } catch (err) {
    if (!isEntityParseError(err)) {
      logEvent("grammar_check.reply_failed", errorFields(err), "error");
      return;
    }
  }
  await ctx.reply(htmlToPlain(html), extra).catch((err: unknown) => {
    logEvent("grammar_check.reply_failed", errorFields(err), "error");
  });
}

/** Checks one text: length cap, daily limit, credit meter, AI, render. */
export async function handleGrammarCheckText(ctx: BotContext, text: string): Promise<void> {
  sendTypingIndicator(ctx);

  const settings = await getRequestSettings(ctx, ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(iLang) ? iLang : "en";
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  if (text.length > GRAMMAR_MAX_INPUT_LENGTH) {
    await ctx.reply(t("grammarCheckInputTooLong", lang, { max: GRAMMAR_MAX_INPUT_LENGTH }), {
      reply_markup: grammarExitKeyboard(lang),
    });
    return;
  }

  // Re-checked on every turn, not only on entry: the mode outlives the day the
  // user entered it in, and a downgrade lands while the mode is still active.
  const plan = ctx.user.subscriptionPlan;
  if (!(await ensureGrammarCheckDailyQuota(ctx, plan, lang))) {
    await leaveSpentMode(ctx);
    return;
  }
  const creditCost = await ensureAiQuota(ctx, plan, lang, "grammarCheck");
  if (creditCost === null) {
    await leaveSpentMode(ctx);
    return;
  }

  const { model, fallbackModel, levels } = await resolveMentorModels(ctx.services, ctx.user.id, plan);

  const loader = await sendLoader(ctx, "mentor", lang, learningLangs);
  const stopTimer = grammarCheckDuration.startTimer();
  try {
    const outcome = await withTimeout(
      checkGrammar(
        { text, nativeLang, learningLangs, levels, interfaceLang: lang },
        ctx.services.ai.generateObject,
        model,
        {
          userId: ctx.user.id,
          maxTokens: GRAMMAR_CHECK_MAX_TOKENS,
          budgetMs: LONG_OP_TIMEOUT_MS,
          failover: buildAiFailover(LONG_OP_TIMEOUT_MS, fallbackModel),
        },
      ),
      LONG_OP_TIMEOUT_MS,
    );
    stopTimer();
    grammarCheckCounter.inc({ status: outcome.status === "checked" ? "success" : "unsupported_language" });
    // Billed on any answer the model produced — a free refusal would be an unmetered
    // AI call — but an out-of-set text is billed under a tag the daily count skips.
    if (outcome.status === "checked") {
      await recordAiUsage(ctx, "grammarCheck", creditCost, outcome.language);
    } else {
      await recordAiUsage(ctx, "grammarCheckOutOfSet", creditCost);
    }
    await dismissLoader(ctx, loader);

    const keyboard = { reply_markup: grammarExitKeyboard(lang) };
    if (outcome.status === "unsupported_language") {
      logEvent("grammar_check.unsupported_language", { detectedLanguage: outcome.detectedLanguage });
      const languages = [nativeLang, ...learningLangs.filter((code) => code !== nativeLang)]
        .map((code) => ctx.services.languageCache.getLangDisplay(code))
        .join(", ");
      await ctx.reply(t("grammarCheckUnsupportedLanguage", lang, { languages }), keyboard);
      return;
    }

    logEvent("grammar_check.completed", { language: outcome.language, issues: outcome.errors.length });
    await replyHtmlOrPlain(ctx, renderGrammarCheck(outcome, lang), keyboard);
  } catch (err) {
    stopTimer();
    grammarCheckCounter.inc({ status: "error" });
    logEvent("grammar_check.failed", { textLength: text.length, ...errorFields(err) }, "error");
    await dismissLoader(ctx, loader);
    // Nothing is persisted before the answer, so a retry cannot double-bill.
    if (isUserFacingTimeout(err)) {
      await replyWithRetry(ctx, t("loadingTimeout", lang), lang, { kind: "grammar", text });
      return;
    }
    await ctx.reply(t("grammarCheckError", lang), { reply_markup: grammarExitKeyboard(lang) });
  } finally {
    loader.stop();
  }
}

/**
 * `grammar:exit` → back to translate mode. Idempotent: the button stays on old
 * answers, and tapping it in translate mode just re-confirms the direction.
 */
export async function handleGrammarExitCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  // >48h-old messages refuse edits — the switch works anyway.
  await ctx.editMessageReplyMarkup().catch(() => {});
  const { lang, fromLang, toLangs } = await activateTranslateMode(ctx);
  await ctx.reply(t("translateModeReturned", lang, { fromLang, toLangs }));
}
