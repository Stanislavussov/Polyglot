/**
 * Mentor idle re-confirm prompt.
 *
 * A user who comes back to the chat after a long pause usually means to
 * translate a word, not to continue a conversation they have forgotten — but
 * guessing costs a paid AI call in the wrong mode. So the message is held and
 * the bot asks, once, which mode it belongs to.
 *
 * The prompt is a plain `ctx.reply` (a content message) on purpose: the user
 * may tap it minutes later, so it must outlive whatever the chat sends in
 * between — a prompt whose buttons vanish first would strand the held message.
 */
import { isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import { mentorIdlePromptCounter } from "../../metrics.js";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import { isMentorIdle, markMentorActivity, takeMentorIdlePrompt } from "../../modes/mode-policy.js";
import type { BotContext } from "../../types.js";
import { handleMentorExitCallback } from "./mentor-exit.helper.js";
import { handleMentorText, MENTOR_MAX_INPUT_LENGTH } from "./mentor-mode.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";
import { handleTranslateText } from "./translate-flow.js";

export const MENTOR_IDLE_STAY_CALLBACK = "mentor:idle:stay";
export const MENTOR_IDLE_EXIT_CALLBACK = "mentor:idle:exit";

export function mentorIdleKeyboard(lang: SupportedLang): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t("mentorIdleStayButton", lang), callback_data: MENTOR_IDLE_STAY_CALLBACK },
        { text: t("mentorIdleSwitchButton", lang), callback_data: MENTOR_IDLE_EXIT_CALLBACK },
      ],
    ],
  };
}

async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await getRequestSettings(ctx, ctx.user.id);
  const rawLang = settings?.interfaceLang ?? "en";
  return isSupported(rawLang) ? rawLang : "en";
}

/**
 * Holds the message behind the re-confirm prompt when the mentor mode has been
 * silent past its policy window. Returns false to let the router run the turn
 * as it does today.
 */
export async function maybePromptMentorIdle(ctx: BotContext, text: string): Promise<boolean> {
  const lastTurnAt = ctx.session.mentor?.lastTurnAt;
  const now = Date.now();
  if (lastTurnAt === undefined || !isMentorIdle(ctx.session, now)) return false;
  // Over-long input is refused by the turn itself; holding it would only put an
  // unbounded string in the session row for a message that can never run.
  if (text.length > MENTOR_MAX_INPUT_LENGTH) return false;

  const lang = await resolveInterfaceLang(ctx);

  const previous = ctx.session.mentorIdlePrompt;
  if (previous && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, previous.promptMsgId).catch(() => {});
  }

  const sent = await ctx.reply(t("mentorIdleQuestion", lang), { reply_markup: mentorIdleKeyboard(lang) });
  // Written only once the prompt is on screen: a hold whose buttons never arrived
  // would swallow the message with no way to release it.
  ctx.session.mentorIdlePrompt = { text, userMsgId: ctx.message?.message_id, promptMsgId: sent.message_id };

  logEvent("mentor.idle_prompt_shown", { idleMs: now - lastTurnAt });
  mentorIdlePromptCounter.inc({ outcome: "shown" });
  return true;
}

/** `mentor:idle:stay` → run the held message as a normal mentor turn. */
export async function handleMentorIdleStayCallback(ctx: BotContext): Promise<void> {
  // Synchronous read-then-delete before any await, mirroring `takeRetryAction`:
  // a double tap must not launch the same paid turn twice.
  const hold = takeMentorIdlePrompt(ctx.session);

  if (!hold) {
    // Re-stamp without a threadId: an existing pin survives, and a session that
    // lost `mentor` stays lost so DB thread recovery still applies.
    markMentorActivity(ctx.session);
    logEvent("mentor.idle_prompt_choice", { choice: "stale" });
    mentorIdlePromptCounter.inc({ outcome: "stale" });
    // Owns the ack: a plain answerCallbackQuery first would consume the query and
    // the alert would never reach the user.
    await answerStaleCallback(ctx, { action: "mentorIdleStay" });
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }

  // Ack before the multi-second turn so Telegram's button spinner stops.
  await ctx.answerCallbackQuery().catch(() => {});
  // Retire the tapped buttons; >48h-old messages refuse edits — the turn runs anyway.
  await ctx.editMessageReplyMarkup().catch(() => {});

  logEvent("mentor.idle_prompt_choice", { choice: "stay" });
  mentorIdlePromptCounter.inc({ outcome: "stay" });
  // The confirmation is itself activity: a turn that dies on the paywall or the
  // daily cap returns before the completed-turn stamp, and without this the
  // next message would re-prompt forever.
  markMentorActivity(ctx.session);
  // No updateActiveMode: the user confirmed the mode they are already in. The
  // thread is left to `resolveThreadId`, which already reads the session pin.
  await handleMentorText(ctx, hold.text, { userMessageId: hold.userMsgId });
}

/** `mentor:idle:exit` → switch to translate mode and translate the held message. */
export async function handleMentorIdleExitCallback(ctx: BotContext): Promise<void> {
  // Before the switch: `activateTranslateMode` clears the slot, so reading the
  // hold afterwards would lose the very text this branch exists to translate.
  const hold = takeMentorIdlePrompt(ctx.session);

  // Same switch as the mentor-exit button, down to the ack and the confirmation.
  await handleMentorExitCallback(ctx);

  if (!hold) {
    logEvent("mentor.idle_prompt_choice", { choice: "stale" });
    mentorIdlePromptCounter.inc({ outcome: "stale" });
    return;
  }

  logEvent("mentor.idle_prompt_choice", { choice: "translate" });
  mentorIdlePromptCounter.inc({ outcome: "translate" });
  await handleTranslateText(ctx, hold.text);
}
