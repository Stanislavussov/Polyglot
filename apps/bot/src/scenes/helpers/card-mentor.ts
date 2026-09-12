/**
 * `tr:mentor:{msgId}` — "Ask the mentor" on a translation card.
 *
 * The tap does not spend a turn: it opens a prompt asking what the user wants
 * to clarify, in their interface language. Whatever they type next becomes the
 * question, and the card travels with it — the mentor answers about the sense
 * on screen rather than re-deriving one from the bare word. A user with nothing
 * particular in mind taps "Just explain it" and gets the card's own question,
 * which is what this button used to do on its own.
 *
 * Sending the question ENTERS mentor mode. That is the point of the prompt: the
 * button no longer changes the meaning of the next typed word behind the user's
 * back — it asks for that word. From there every mentor rule applies exactly as
 * it does after `/mentor`: the thread, the exit and new-topic buttons, the idle
 * re-confirm, the daily allowance, the credit meter, the failover — because the
 * turn goes through the same `handleMentorText`.
 */
import { FEATURE_KEYS, getLanguageName, isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import { MODE_POLICIES, startMentorThread } from "../../modes/mode-policy.js";
import { trackProductEvent } from "../../observability/product-events.js";
import type { BotContext, SessionData } from "../../types.js";
import { type CardMentorContext, composeCardMentorTurn } from "./card-mentor-context.js";
import { handleMentorText, MENTOR_MAX_INPUT_LENGTH } from "./mentor-mode.helper.js";
import { ensurePaidFeature, ensurePaidFeatureForMessage } from "./paid-feature.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";

export const CARD_MENTOR_EXPLAIN_CALLBACK = "mentor:ask:explain";
export const CARD_MENTOR_CANCEL_CALLBACK = "mentor:ask:cancel";

/**
 * How long an unanswered prompt keeps claiming the next message.
 *
 * The mentor's own idle window, and for the same reason: past it, a message is
 * far likelier to be a word to translate than an answer to a question the user
 * has forgotten — and guessing wrong spends a paid turn in the wrong mode. The
 * buttons stay live regardless; an explicit tap is never ambiguous.
 */
const ASK_PROMPT_TTL_MS = MODE_POLICIES.mentor.idleTimeoutMs ?? 15 * 60_000;

/** What the prompt offers besides typing: the old one-tap question, or nothing. */
function cardMentorAskKeyboard(lang: SupportedLang): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: t("cardMentorAskExplainButton", lang), callback_data: CARD_MENTOR_EXPLAIN_CALLBACK },
        { text: t("cardMentorAskCancelButton", lang), callback_data: CARD_MENTOR_CANCEL_CALLBACK },
      ],
    ],
  };
}

async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await getRequestSettings(ctx, ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return isSupported(iLang) ? iLang : "en";
}

/**
 * The question the card asks on the user's behalf when they tap "Just explain it".
 *
 * It names the source language explicitly because the text alone is ambiguous
 * for the model far more often than for the reader — "Gift" is a word in two of
 * the languages this bot supports.
 */
function buildCardQuestion(text: string, sourceLang: string, lang: SupportedLang): string {
  return t("cardMentorQuestion", lang, {
    text,
    lang: getLanguageName(sourceLang, lang),
  });
}

/**
 * Reads and consumes the armed prompt. One-shot and synchronous (before any
 * `await`), mirroring `takeMentorIdlePrompt`: a double tap must not launch the
 * same paid turn twice.
 */
function takeCardMentorAsk(session: SessionData): SessionData["pendingCardMentorAsk"] {
  const pending = session.pendingCardMentorAsk;
  session.pendingCardMentorAsk = undefined;
  return pending;
}

/** The card as the mentor needs to see it, or nothing when the entry has been evicted. */
function readCard(session: SessionData, cardMsgId: number): CardMentorContext | undefined {
  const entry = session.translationMap?.[String(cardMsgId)];
  if (!entry) return undefined;
  return {
    output: entry.output,
    contextHint: entry.contextHint,
    grammarBreakdown: entry.grammarBreakdown,
    etymology: entry.etymology,
  };
}

/**
 * The mode switch `/mentor` performs, minus its own notice: the answer to this
 * question is the confirmation, and it carries the exit button itself.
 */
async function enterMentorMode(ctx: BotContext): Promise<void> {
  ctx.session.activeMode = "mentor";
  await ctx.services.userRepository.updateActiveMode(ctx.user.id, "mentor");
  trackProductEvent(ctx, "mode.switched", "mentor");
  // No threadId = "fresh thread, do not recover the previous one": a card is a
  // new subject, and inheriting whatever topic was open answers the wrong question.
  startMentorThread(ctx.session);
}

/** Gate, enter mentor mode, and run the question with the card attached. */
async function runCardMentorTurn(
  ctx: BotContext,
  cardMsgId: number,
  question: string,
  opts: { userMessageId?: number },
): Promise<void> {
  const lang = await resolveInterfaceLang(ctx);
  // Gated BEFORE the mode switch, like `/mentor`: a plan that lapsed between the
  // prompt and the answer must not strand the user in a mode whose every message
  // answers with the paywall.
  if (!(await ensurePaidFeatureForMessage(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }

  // An evicted card still gets an answer: the question the user typed is theirs,
  // and refusing it over missing context would be the worse trade.
  const card = readCard(ctx.session, cardMsgId);
  const text = card ? composeCardMentorTurn(card, question) : question;

  await enterMentorMode(ctx);

  logEvent("card.mentor_asked", {
    inputType: ctx.session.translationMap?.[String(cardMsgId)]?.inputType,
    lang: card?.output.sourceLang,
    withCard: card !== undefined,
  });

  await handleMentorText(ctx, text, {
    threadId: crypto.randomUUID(),
    userMessageId: opts.userMessageId,
    // The length guard measures what the user typed, not the card the bot attached.
    userInput: question,
  });
}

/** `tr:mentor:{msgId}` → ask what to clarify. No AI call, no mode change yet. */
export async function handleCardMentorCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = Number.parseInt(data.split(":")[2] ?? "", 10);
  const entry = Number.isFinite(msgId) ? ctx.session.translationMap?.[String(msgId)] : undefined;

  const lang = await resolveInterfaceLang(ctx);

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:mentor", msgId, lang });
    return;
  }

  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }
  await ctx.answerCallbackQuery();

  // The citation form when the model supplied one — the same headword the card
  // prints, so the prompt names the word the user is actually looking at.
  const headword = entry.output.sourceUsage?.headword?.trim() || entry.output.original;

  // Single slot: a second card's prompt supersedes the first, whose buttons would
  // otherwise send the next question about the wrong card.
  const previous = ctx.session.pendingCardMentorAsk;
  if (previous && ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, previous.promptMsgId).catch(() => {});
  }

  const sent = await ctx.reply(t("cardMentorAskPrompt", lang, { text: headword }), {
    reply_markup: cardMentorAskKeyboard(lang),
  });
  // Armed only once the prompt is on screen: a slot whose buttons never arrived
  // would swallow the next word with nothing to explain why.
  ctx.session.pendingCardMentorAsk = { cardMsgId: msgId, promptMsgId: sent.message_id, askedAt: Date.now() };

  logEvent("card.mentor_prompt_shown", { inputType: entry.inputType, lang: entry.output.sourceLang });
}

/**
 * The armed prompt claims the next plain message as its question.
 *
 * Returns false when there is nothing armed, or when the prompt has gone stale —
 * the router then treats the message as it would any other.
 */
export async function tryHandleCardMentorQuestion(ctx: BotContext, text: string): Promise<boolean> {
  const pending = ctx.session.pendingCardMentorAsk;
  if (!pending) return false;

  const age = Date.now() - pending.askedAt;
  if (age > ASK_PROMPT_TTL_MS) {
    ctx.session.pendingCardMentorAsk = undefined;
    logEvent("card.mentor_prompt_expired", { ageMs: age });
    return false;
  }

  if (text.length > MENTOR_MAX_INPUT_LENGTH) {
    // The prompt stays armed: the user has a question to shorten, not a flow to
    // leave — dropping the slot here would send the retry off to be translated.
    const lang = await resolveInterfaceLang(ctx);
    await ctx.reply(t("mentorInputTooLong", lang, { max: MENTOR_MAX_INPUT_LENGTH }));
    return true;
  }

  ctx.session.pendingCardMentorAsk = undefined;
  logEvent("card.mentor_prompt_answered", { questionLength: text.length });
  await runCardMentorTurn(ctx, pending.cardMsgId, text, { userMessageId: ctx.message?.message_id });
  return true;
}

/** `mentor:ask:explain` → run the card's own question, the way the button used to. */
export async function handleCardMentorExplainCallback(ctx: BotContext): Promise<void> {
  const pending = takeCardMentorAsk(ctx.session);
  const card = pending ? readCard(ctx.session, pending.cardMsgId) : undefined;

  if (!pending || !card) {
    // The stale helper owns the ack: answering the query first would consume it
    // and the alert would never reach the user.
    await answerStaleCallback(ctx, { action: "mentor:ask:explain", msgId: pending?.cardMsgId });
    await ctx.editMessageReplyMarkup().catch(() => {});
    return;
  }

  // Ack before the multi-second turn so Telegram's button spinner stops.
  await ctx.answerCallbackQuery().catch(() => {});
  // Retire the tapped buttons; >48h-old messages refuse edits — the turn runs anyway.
  await ctx.editMessageReplyMarkup().catch(() => {});

  const lang = await resolveInterfaceLang(ctx);
  const headword = card.output.sourceUsage?.headword?.trim() || card.output.original;
  const question = buildCardQuestion(headword, card.output.sourceLang, lang);

  // Anchored to the card: the question was never typed, so without an anchor the
  // thread would hold an answer to nothing and a reply would read it that way.
  await runCardMentorTurn(ctx, pending.cardMsgId, question, { userMessageId: pending.cardMsgId });
}

/** `mentor:ask:cancel` → drop the prompt. The user stays where they were. */
export async function handleCardMentorCancelCallback(ctx: BotContext): Promise<void> {
  const pending = takeCardMentorAsk(ctx.session);
  await ctx.answerCallbackQuery().catch(() => {});

  const lang = await resolveInterfaceLang(ctx);
  // Edited in place, so a cancelled prompt leaves the chat as it found it. The
  // edit drops the keyboard with the text; a >48h-old prompt refuses the edit and
  // keeps buttons that now resolve as stale, which is the same dead end as any
  // other expired card action.
  await ctx.editMessageText(t("cardMentorAskCancelled", lang)).catch(() => {});

  logEvent("card.mentor_prompt_cancelled", { stale: pending === undefined });
}
