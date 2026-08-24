/**
 * Mentor answer buttons: start a fresh topic, or exit back to translate mode.
 *
 * The buttons ride on mentor answers (content messages, never swept), so both
 * actions are always on screen — the mode-on notice that also carries the exit
 * is technical and disappears with the next message. One thread per topic is
 * the model the whole feature is built on (history windows, reply-continuations,
 * phase-2 topic summaries), so the "new topic" button is how a user is steered
 * into it without ever typing /mentor again.
 */
import { FEATURE_KEYS, isSupported, type SupportedLang, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { BotContext } from "../../types.js";
import { activateTranslateMode } from "../translate.scene.js";
import { ensurePaidFeatureForMessage } from "./paid-feature.helper.js";

export const MENTOR_EXIT_CALLBACK = "mentor:exit";
export const MENTOR_NEW_TOPIC_CALLBACK = "mentor:new";

/** Exit-only keyboard — for the mode-on notice, where a fresh topic just started. */
export function mentorExitKeyboard(lang: SupportedLang): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: t("mentorExitButton", lang), callback_data: MENTOR_EXIT_CALLBACK }]] };
}

/** Full keyboard for mentor answers: new topic + exit. */
export function mentorAnswerKeyboard(lang: SupportedLang): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t("mentorNewTopicButton", lang), callback_data: MENTOR_NEW_TOPIC_CALLBACK },
        { text: t("mentorExitButton", lang), callback_data: MENTOR_EXIT_CALLBACK },
      ],
    ],
  };
}

/**
 * `mentor:exit` → switch to translate mode. Idempotent on purpose: the button
 * lives on old answers too, and tapping it while already in translate mode just
 * re-confirms the direction — same outcome as typing /translate.
 */
export async function handleMentorExitCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  // Retire the tapped button; >48h-old messages refuse edits — the switch works anyway.
  await ctx.editMessageReplyMarkup().catch(() => {});
  ctx.session.mentor = undefined;
  // Same mode switch as /translate (shared implementation), but the confirmation
  // says where the user LANDED — a bare "ru → cs" line after leaving a chat mode
  // reads as noise, not as "you are back in translation, send a word".
  const { lang, fromLang, toLangs } = await activateTranslateMode(ctx);
  await ctx.reply(t("translateModeReturned", lang, { fromLang, toLangs }));
}

/**
 * `mentor:new` → start a fresh mentor thread, entering mentor mode if needed
 * (the button also lives on old answers a translate-mode user replies to).
 * Gated like every mentor entry point; the tapped message keeps its keyboard —
 * buttons on older answers stay useful.
 */
export async function handleMentorNewTopicCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  if (!(await ensurePaidFeatureForMessage(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }

  ctx.session.activeMode = "mentor";
  await ctx.services.userRepository.updateActiveMode(ctx.user.id, "mentor");
  // Empty object = "fresh thread, no recovery" — the first turn mints a new id.
  ctx.session.mentor = {};

  await ctx.reply(t("mentorNewTopicStarted", lang));
}
