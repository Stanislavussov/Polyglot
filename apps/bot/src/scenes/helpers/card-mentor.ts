/**
 * `tr:mentor:{msgId}` — "Ask the mentor" on a translation card.
 *
 * The card already knows what the user is looking at, so the question does not
 * have to be typed: the handler composes it from the card and runs one ordinary
 * mentor turn. Everything else — the plan gate, the daily allowance, the credit
 * meter, the model, the failover — is whatever a typed mentor question gets,
 * because this goes through the same `handleMentorText`.
 *
 * The turn opens its own thread and does not switch the user into mentor mode: a
 * card is read in translate mode, and a button that silently changed the meaning
 * of the next typed word would be a trap. The answer is still a normal mentor
 * message, so replying to it continues this topic like any other.
 */
import { FEATURE_KEYS, getLanguageName, isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { handleMentorText } from "./mentor-mode.helper.js";
import { ensurePaidFeature } from "./paid-feature.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";

/**
 * The question the card asks on the user's behalf, in their interface language.
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

export async function handleCardMentorCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = Number.parseInt(data.split(":")[2] ?? "", 10);
  const entry = Number.isFinite(msgId) ? ctx.session.translationMap?.[String(msgId)] : undefined;

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:mentor", msgId, lang });
    return;
  }

  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }
  await ctx.answerCallbackQuery();

  // The citation form when the model supplied one — the same headword the card
  // prints, so the mentor explains the word the user is actually looking at.
  const headword = entry.output.sourceUsage?.headword?.trim() || entry.output.original;
  const question = buildCardQuestion(headword, entry.output.sourceLang, lang);

  logEvent("card.mentor_asked", { inputType: entry.inputType, lang: entry.output.sourceLang });

  // A fresh thread id rather than the session's pinned one: the card is a new
  // subject, and inheriting whatever topic was open would answer the wrong
  // question. Anchoring the user turn to the card keeps the thread readable.
  await handleMentorText(ctx, question, { threadId: crypto.randomUUID(), userMessageId: msgId });
}
