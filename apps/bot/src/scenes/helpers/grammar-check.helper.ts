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
  type GrammarCheckOutcome,
  type GrammarIssueCategory,
  type I18nKey,
  isSupported,
  logEvent,
  type SupportedLang,
  t,
} from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import { grammarCheckCounter, grammarCheckDuration } from "../../metrics.js";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import { esc } from "../../renderers/card-sections.js";
import type { BotContext } from "../../types.js";
import { buildAiFailover, resolveDefaultAIModel, resolveFallbackAIModel } from "../../utils/ai-model.js";
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

export const GRAMMAR_MAX_INPUT_LENGTH = 1000;
export const GRAMMAR_EXIT_CALLBACK = "grammar:exit";

/**
 * Output budget for one check: up to eight issues, each with an explanation and
 * an example, plus the corrected text — well past the mentor's 700-token prose cap.
 */
const GRAMMAR_CHECK_MAX_TOKENS = 2000;

/** Telegram's limit is 4096; the margin absorbs the "and N more" line. */
const MAX_REPLY_LENGTH = 3900;

const CATEGORY_KEYS: Record<GrammarIssueCategory, I18nKey> = {
  grammar: "grammarCategoryGrammar",
  vocabulary: "grammarCategoryVocabulary",
  preposition: "grammarCategoryPreposition",
  article: "grammarCategoryArticle",
  word_order: "grammarCategoryWordOrder",
  agreement: "grammarCategoryAgreement",
  tense: "grammarCategoryTense",
  spelling: "grammarCategorySpelling",
  punctuation: "grammarCategoryPunctuation",
  other: "grammarCategoryOther",
};

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
      `🏷 ${t(CATEGORY_KEYS[issue.category], lang)}`,
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

/** Checks one text: length cap, daily limit, credit meter, AI, render. */
export async function handleGrammarCheckText(ctx: BotContext, text: string): Promise<void> {
  sendTypingIndicator(ctx);

  const settings = await getRequestSettings(ctx, ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(iLang) ? iLang : "en";
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  if (text.length > GRAMMAR_MAX_INPUT_LENGTH) {
    await ctx.reply(t("mentorInputTooLong", lang, { max: GRAMMAR_MAX_INPUT_LENGTH }), {
      reply_markup: grammarExitKeyboard(lang),
    });
    return;
  }

  // Re-checked on every turn, not only on entry: the mode outlives the day the
  // user entered it in, and a downgrade lands while the mode is still active.
  const plan = ctx.user.subscriptionPlan;
  if (!(await ensureGrammarCheckDailyQuota(ctx, plan, lang))) {
    return;
  }
  const creditCost = await ensureAiQuota(ctx, plan, lang, "grammarCheck");
  if (creditCost === null) {
    return;
  }

  // Same model as the mentor: a check is a grammar explanation, which is what the
  // admin-managed mentor model was chosen for; an empty override follows the
  // regular plan → default chain.
  const mentorConfig = await ctx.services.settings.getMentorConfig();
  const overrideModel = mentorConfig.modelId.trim();
  const [model, fallbackModel, levelRows] = await Promise.all([
    overrideModel ? Promise.resolve(overrideModel) : resolveDefaultAIModel(ctx.services.settings, plan),
    resolveFallbackAIModel(ctx.services.settings),
    ctx.services.userRepository.getLanguageLevels(ctx.user.id),
  ]);
  const levels = Object.fromEntries(levelRows.map((row) => [row.languageCode, row.proficiencyLevel]));

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
    // Billed on any answer the model produced, an out-of-set language included:
    // the call cost the same, and a free refusal would be an unmetered AI call.
    await recordAiUsage(ctx, "grammarCheck", creditCost, outcome.status === "checked" ? outcome.language : null);
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
    const html = renderGrammarCheck(outcome, lang);
    // Escaped content should always parse; the plain fallback is for a locale
    // string with broken markup, where a raw tag on screen beats a lost answer.
    await ctx.reply(html, { ...keyboard, parse_mode: "HTML" }).catch(() => ctx.reply(html, keyboard));
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
