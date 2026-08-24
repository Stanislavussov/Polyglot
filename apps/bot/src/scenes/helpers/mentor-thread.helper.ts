/**
 * Reply-continuation routing for mentor threads.
 *
 * A user reply to any mentor answer continues THAT thread's conversation, in
 * any mode — Telegram carries the replied-to message id, and `mentor_messages`
 * maps it back to its thread. A miss (translation cards, deleted loaders,
 * technical messages, replies to the user's own messages) falls through to the
 * normal mode routing untouched.
 */
import { logEvent } from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { handleMentorText } from "./mentor-mode.helper.js";

/** Returns true when the update was consumed as a mentor reply-continuation. */
export async function tryHandleMentorReply(ctx: BotContext, text: string): Promise<boolean> {
  const replyTo = ctx.message?.reply_to_message;
  const chatId = ctx.chat?.id;
  // Cheap pre-filter: only replies to OUR messages can anchor a thread.
  if (!replyTo?.from?.is_bot || replyTo.from.id !== ctx.me.id || chatId === undefined) {
    return false;
  }

  let threadId: string | null;
  try {
    threadId = await ctx.services.mentorMessageRepository.findThreadByMessage(chatId, replyTo.message_id);
  } catch (err) {
    // A DB blip must degrade to normal routing, never break translate.
    logEvent("mentor.reply_lookup_failed", { err: err instanceof Error ? err.message : String(err) }, "warn");
    return false;
  }
  if (!threadId) {
    return false;
  }

  logEvent("mentor.reply_continuation", { activeMode: ctx.session.activeMode });
  await handleMentorText(ctx, text, { threadId });
  return true;
}
