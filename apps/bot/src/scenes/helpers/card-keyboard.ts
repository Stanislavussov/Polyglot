/**
 * One place that decides which buttons a translation card carries.
 *
 * A card's keyboard is rebuilt on every interaction — expand, collapse, after a
 * grammar breakdown, after an etymology, after the grammar-detail flow is
 * cancelled — and each rebuild used to compute eligibility on its own. They
 * drifted: a rebuild that forgot the pronunciation row silently removed the
 * speaker from a card, and none of them restored the source-language override.
 * Every rebuild now goes through {@link resolveCardKeyboardOptions}, so a card's
 * buttons depend only on the card, never on which button was tapped last.
 */
import { type InputType, resolveTemplate, type SupportedLang } from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { buildTranslationKeyboard, type TranslationKeyboardOptions } from "../../renderers/translation.renderer.js";
import type { BotContext, SessionData } from "../../types.js";
import { resolveLanguageOrder } from "../../utils/language-order.js";
import { resolveLockedBadges } from "./paid-feature.helper.js";
import { isEtymologyEligible, resolvePronounceLangs } from "./translate-mode.shared.js";

type CardEntry = NonNullable<SessionData["translationMap"]>[string];

/**
 * Whether a card offers the on-demand grammar breakdown at all: never for a
 * single word (its grammar is on the card already), always for a sentence, and
 * for a phrase only when the template is not printing the breakdown inline.
 */
function isGrammarEligible(inputType: InputType, templateShowsGrammar: boolean): boolean {
  return inputType !== "word" && (inputType === "sentence" || !templateShowsGrammar);
}

/**
 * Every keyboard option a card's current state implies, except `expanded` —
 * which is the caller's business, since it is the one thing a tap changes.
 */
async function resolveCardKeyboardOptions(
  ctx: BotContext,
  entry: CardEntry,
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<TranslationKeyboardOptions> {
  const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const effectiveTemplate = resolveTemplate(savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null);
  const order = await resolveLanguageOrder(ctx);

  const isSentence = entry.inputType === "sentence";
  const grammarShown = entry.grammarBreakdown !== undefined;

  return {
    interfaceLang: lang,
    msgId,
    isAlreadySaved: entry.savedWordId !== undefined,
    // Each aid retires once its section is on the card — there is nothing left to
    // generate, and the section is what the button promised.
    showGrammarButton: isGrammarEligible(entry.inputType, effectiveTemplate.fields.grammarBreakdown) && !grammarShown,
    // Per-language detail only makes sense once a breakdown exists to drill into,
    // and a sentence card has no per-language blocks to attach it to.
    showGrammarDetailButton: grammarShown && !isSentence,
    showEtymologyButton:
      isEtymologyEligible(entry.inputType, entry.output.sourceLang, nativeLang) && entry.etymology === undefined,
    showMentorButton: true,
    sourceOverrideLangs: entry.sourceOverrideLangs ?? [],
    pronounceLangs: await resolvePronounceLangs(ctx, entry.output, order),
    locked: await resolveLockedBadges(ctx),
  };
}

/** The card's keyboard, in the expanded/collapsed state the card itself records. */
export async function buildCardKeyboard(
  ctx: BotContext,
  entry: CardEntry,
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<InlineKeyboard> {
  const options = await resolveCardKeyboardOptions(ctx, entry, msgId, lang, nativeLang);
  return buildTranslationKeyboard({ ...options, expanded: entry.actionsExpanded === true });
}
