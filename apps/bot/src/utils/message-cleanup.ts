/**
 * Message cleanup utilities.
 *
 * Tracks IDs of technical (non-translation) bot messages so they can be
 * deleted after a scene ends or settings change. Translation result cards
 * and saved words must NEVER be added here.
 */
import { logger } from "@polyglot/core";
import type { BotContext } from "../types.js";

/**
 * Register a bot message as technical — it will be deleted later by
 * `cleanupTechnicalMessages`. Returns the message id for convenience.
 */
export function trackTechnicalMessage(ctx: BotContext, messageId: number): number {
  const ids = ctx.session.technicalMessages ?? [];
  if (!ids.includes(messageId)) {
    ids.push(messageId);
    ctx.session.technicalMessages = ids;
  }
  return messageId;
}

/**
 * Delete all tracked technical messages and clear the list.
 * Silently ignores Telegram errors (message already deleted, etc.).
 */
export async function cleanupTechnicalMessages(ctx: BotContext): Promise<void> {
  const ids = ctx.session.technicalMessages ?? [];
  if (ids.length === 0) return;

  const chatId = ctx.chat?.id;
  if (!chatId) {
    ctx.session.technicalMessages = [];
    return;
  }

  // Delete in parallel, ignore failures
  await Promise.all(
    ids.map(async (messageId) => {
      try {
        await ctx.api.deleteMessage(chatId, messageId);
      } catch (err) {
        logger.debug({ err, messageId, chatId }, "Failed to delete technical message");
      }
    }),
  );

  ctx.session.technicalMessages = [];
}

/**
 * Convenience wrapper: reply a technical message and track it for cleanup.
 * Use this for menus, prompts, hints, loading spinners — never for translation cards.
 */
export async function replyTechnical(
  ctx: BotContext,
  text: string,
  extra?: Parameters<BotContext["reply"]>[1],
): Promise<ReturnType<BotContext["reply"]>> {
  const msg = await ctx.reply(text, extra);
  trackTechnicalMessage(ctx, msg.message_id);
  return msg;
}
