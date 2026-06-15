/**
 * Message cleanup utilities.
 *
 * Tracks IDs of technical (non-translation) bot messages so they can be
 * deleted after a scene ends or settings change. Translation result cards
 * and saved words must NEVER be added here.
 */
import { logger } from "@polyglot/core";
import type { Context } from "grammy";
import type { SessionData } from "../types.js";

/** Any grammY context that carries our session shape. */
type ContextWithSession = Context & { session: SessionData };

/**
 * Register a bot message as technical — it will be deleted later by
 * `cleanupTechnicalMessages`. Returns the message id for convenience.
 */
export function trackTechnicalMessage(ctx: ContextWithSession, messageId: number): number {
  if (!ctx.session) return messageId;
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
export async function cleanupTechnicalMessages(ctx: ContextWithSession): Promise<void> {
  if (!ctx.session) return;
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
  ctx: ContextWithSession,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
): Promise<ReturnType<Context["reply"]>> {
  const msg = await ctx.reply(text, extra);
  trackTechnicalMessage(ctx, msg.message_id);
  return msg;
}
