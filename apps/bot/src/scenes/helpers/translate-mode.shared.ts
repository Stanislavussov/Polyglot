/**
 * Shared private helpers for the translate-mode handler modules (Fable T22/B2
 * slice (e)). These cross-cutting helpers are used by more than one of the split
 * modules (`translate-flow`, `clarification`, `card-actions`, `out-of-set`), so
 * they live here and are imported directly — this is a plain helper module, not
 * a barrel (CLAUDE.md Hard Rule #4).
 */
import {
  getLanguageName,
  type InputType,
  type LanguageOrderContext,
  logger,
  type SupportedLang,
  selectPronounceableLangs,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../../types.js";
import { replyTechnical } from "../../utils/message-cleanup.js";
import { setPendingOutOfSet } from "./pending-out-of-set.helper.js";

/**
 * Whether the Etymology button should be offered for this translation.
 *
 * Etymology applies to words and short phrases in a language the user is
 * learning — i.e. the source term is NOT in their native language. Sentences
 * and native-language input are excluded.
 */
export function isEtymologyEligible(inputType: InputType, sourceLang: string, nativeLang: string): boolean {
  return (inputType === "word" || inputType === "phrase") && sourceLang !== nativeLang;
}

/**
 * Languages on this card that get a 🔊 button, or an empty list when there are
 * none to offer.
 *
 * Returns empty — so no row is rendered at all — whenever TTS is off or has no
 * model configured, and for sentence cards, which are out of scope for v1
 * (Task 77). Everything else is the "only the words being learned" rule, which
 * lives in core as {@link selectPronounceableLangs}.
 */
export async function resolvePronounceLangs(
  ctx: BotContext,
  translations: Readonly<Record<string, { text: string } | undefined>>,
  inputType: InputType,
  order: LanguageOrderContext,
): Promise<readonly string[]> {
  if (inputType === "sentence") return [];
  const config = await ctx.services.settings.getTtsConfig();
  if (!config.enabled || !config.modelId) return [];
  return selectPronounceableLangs(translations, order);
}

export function normalizeLearningLangs(nativeLang: string, learningLangs: readonly string[]): string[] {
  return learningLangs.filter((code, index) => code !== nativeLang && learningLangs.indexOf(code) === index);
}

export function getUserLanguageGroup(nativeLang: string, learningLangs: readonly string[]): string[] {
  return [nativeLang, ...learningLangs].filter((code, index, all) => all.indexOf(code) === index);
}

export function clearPendingClarification(ctx: BotContext): void {
  ctx.session.pendingClarification = undefined;
  ctx.session.awaitingTranslationClarificationContext = undefined;
}

/**
 * Offer the "add and translate" choice when the input is confidently in a
 * SUPPORTED language the user doesn't study yet. Replaces the old hard block —
 * the user can add the language (and translate) or translate just this once.
 * Stores the word on the session so the tr:oos:* callback can complete it.
 */
export async function showAddLanguagePrompt(
  ctx: BotContext,
  lang: SupportedLang,
  outOfSetLang: string,
  word: string,
  contextHint: string | undefined,
): Promise<void> {
  ctx.services.languageDetectionRepository
    .record({ userId: ctx.user.id, eventType: "out_of_set", word, sourceLang: outOfSetLang })
    .catch((err: unknown) => {
      logger.warn({ err }, "Failed to record language detection event");
    });

  const langName = getLanguageName(outOfSetLang, lang);
  const keyboard = new InlineKeyboard()
    .text(t("outOfSetAddButton", lang, { lang: langName }), `tr:oos:add:${outOfSetLang}`)
    .row()
    .text(t("outOfSetTranslateOnce", lang), `tr:oos:once:${outOfSetLang}`)
    .row()
    .text(t("mistypeCancel", lang), "tr:oos:cancel");

  const promptMsg = await replyTechnical(ctx, t("outOfSetPrompt", lang, { lang: langName }), {
    reply_markup: keyboard,
  });

  // Key the pending word by the prompt's message id so a later prompt cannot
  // overwrite this one's word (single-slot race, T02). Capped: entries are only
  // removed on a button tap, so ignored prompts would otherwise pile up forever.
  setPendingOutOfSet(ctx.session, promptMsg.message_id, { lang: outOfSetLang, word, contextHint });
}
