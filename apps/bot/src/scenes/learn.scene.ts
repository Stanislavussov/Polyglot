/**
 * Learning hub — `/learn` and the 🎓 category button.
 *
 * The practice modes used to be spread across the reply keyboard and the command list.
 * `/review` was in neither — commented out of the command list and never on a keyboard —
 * so spaced repetition was reachable only by typing the command from memory. The hub is
 * what gives it a button at all. (`/mentor` is a different case: it is listed and paid-gated
 * on `develop`, and it also has a hot button of its own.)
 *
 * Each entry delegates to the command handler that already owned the mode; this file
 * is navigation and nothing else.
 */

import { type I18nKey, isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { handleFlashcardCommand } from "./flashcard.scene.js";
import { dismissMenuMessage } from "./helpers/edit-message.helper.js";
import { handleVideosCommand } from "./helpers/video-vocabulary.helper.js";
import { handlePickWordsCommand } from "./helpers/word-picker.helper.js";
import { handleMentorCommand } from "./mentor.scene.js";
import { handleReviewCommand } from "./srs.scene.js";

interface LearnMode {
  readonly callback: string;
  readonly icon: string;
  readonly labelKey: I18nKey;
  readonly run: (ctx: BotContext) => Promise<void>;
}

/**
 * Modes in render order: what to do with words you do not have yet, then the two
 * drills over words you do, then the two open-ended sources.
 */
const LEARN_MODES: readonly LearnMode[] = [
  { callback: "lrn:pick", icon: "✨", labelKey: "menuBtnPickWords", run: handlePickWordsCommand },
  { callback: "lrn:cards", icon: "🎴", labelKey: "menuBtnFlashcards", run: handleFlashcardCommand },
  { callback: "lrn:review", icon: "🔁", labelKey: "menuBtnReview", run: handleReviewCommand },
  { callback: "lrn:videos", icon: "🎬", labelKey: "menuBtnVideos", run: handleVideosCommand },
  { callback: "lrn:mentor", icon: "🧑‍🏫", labelKey: "menuBtnMentor", run: handleMentorCommand },
];

/**
 * Where the hub's ⬅️ button goes. A literal rather than an import from `menu.scene.ts`,
 * which imports this file to render the hub — importing back would close a cycle.
 */
export const LEARN_BACK_CALLBACK = "menu:root";

/**
 * Every hub callback — the match list for the router.
 *
 * `lrn:` and not `learn:`: `LEGACY_ONBOARDING_CALLBACK_PATTERN` is `/^(?:lang|learn|level):/`,
 * the prefixes the pre-Task-72 onboarding conversation emitted. It is registered ahead of
 * this one, so a `learn:` hub button would be swallowed by the legacy onboarding handler
 * and answer nothing at all.
 */
export const LEARN_CALLBACK_PATTERN = /^lrn:/;

export function buildLearnKeyboard(lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const mode of LEARN_MODES) {
    kb.text(`${mode.icon} ${t(mode.labelKey, lang)}`, mode.callback).row();
  }
  kb.text(`⬅️ ${t("back", lang)}`, LEARN_BACK_CALLBACK).row();
  return kb;
}

async function resolveLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return isSupported(iLang) ? iLang : "en";
}

/** `/learn` — opens the hub as its own message, with nothing to edit in place. */
export async function handleLearnCommand(ctx: BotContext): Promise<void> {
  const lang = await resolveLang(ctx);
  logEvent("menu.hub_opened", { hub: "learn" });
  await ctx.reply(t("learnHubTitle", lang), { reply_markup: buildLearnKeyboard(lang) });
}

/**
 * Runs the mode a hub button names.
 *
 * The hub message is removed first: every mode answers with a screen of its own, and
 * a stale menu left above it invites a second tap into a mode the user already left.
 * Deletion is best-effort — Telegram refuses it on a message older than 48 hours, and
 * a lingering menu is not worth failing the tap over.
 */
export async function handleLearnModeCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const mode = LEARN_MODES.find((candidate) => candidate.callback === data);
  if (!mode) {
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.answerCallbackQuery();
  await dismissMenuMessage(ctx);
  logEvent("menu.hub_mode_selected", { hub: "learn", mode: mode.callback });
  await mode.run(ctx);
}
