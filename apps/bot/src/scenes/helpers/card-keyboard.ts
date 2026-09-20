/**
 * One place that decides which buttons a translation card carries.
 *
 * A card's keyboard is rebuilt on every interaction — expand, collapse, after an
 * etymology — and each rebuild used to compute eligibility on its own. They
 * drifted: a rebuild that forgot the pronunciation row silently removed the
 * speaker from a card, and none of them restored the source-language override.
 * Every rebuild now goes through {@link resolveCardKeyboardOptions}, so a card's
 * buttons depend only on the card, never on which button was tapped last.
 */
import type { SupportedLang } from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { buildTranslationKeyboard, type TranslationKeyboardOptions } from "../../renderers/translation.renderer.js";
import type { BotContext, SessionData } from "../../types.js";
import { resolveLanguageOrder } from "../../utils/language-order.js";
import { resolveLockedBadges } from "./paid-feature.helper.js";
import { isEtymologyEligible, resolvePronounceLangs } from "./translate-mode.shared.js";

type CardEntry = NonNullable<SessionData["translationMap"]>[string];

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
  const order = await resolveLanguageOrder(ctx);

  return {
    interfaceLang: lang,
    msgId,
    isAlreadySaved: entry.savedWordId !== undefined,
    inputType: entry.inputType,
    // The aid retires once its section is on the card — there is nothing left to
    // generate, and the section is what the button promised.
    showEtymologyButton:
      isEtymologyEligible(entry.inputType, entry.output.sourceLang, nativeLang) && entry.etymology === undefined,
    showMentorButton: true,
    sourceOverrideLangs: entry.sourceOverrideLangs ?? [],
    pronounceLangs: await resolvePronounceLangs(ctx, entry.output, order),
    locked: await resolveLockedBadges(ctx),
    // A grade on a removed word has no row to land on, so the row waits for the word to come back.
    ...(entry.recallGrade && entry.savedWordId !== undefined ? { grades: entry.recallGrade } : {}),
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
