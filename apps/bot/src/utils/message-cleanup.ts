/**
 * Message cleanup utilities.
 *
 * The bot sends two kinds of message, and only one of them may ever be deleted:
 *
 * - **Technical** — menus, prompts, hints, validation and error notices,
 *   transient status ("translating…"), mode and settings confirmations, empty
 *   states. They are scaffolding for one interaction; once the next one starts
 *   they are noise, and any inline keyboard still attached to them is a future
 *   dead button (Telegram refuses to edit a message older than 48h). Send them
 *   with {@link replyTechnical} so they are swept automatically.
 * - **Content** — translation cards, regenerated cards, detailed analyses,
 *   mentor answers, notifications and nudges, video vocabulary results,
 *   onboarding hook cards. These are what the user came for. Send them with a
 *   plain `ctx.reply` and they are never touched.
 *
 * The sweep runs centrally in `middlewares/technical-cleanup.ts` on every new
 * user message, plus explicitly at scene exits reached by a button tap.
 */
import { logger } from "@polyglot/core";
import type { Context } from "grammy";
import type { SessionData } from "../types.js";

/** Any grammY context that carries our session shape. */
type ContextWithSession = Context & { session: SessionData };

/**
 * Upper bound on the ledger. A chat that somehow never sweeps (every technical
 * message older than 48h is undeletable, so its id would linger forever) must
 * not grow the Postgres-backed session without limit. Oldest ids are dropped
 * first: they are also the ones Telegram is most likely to refuse anyway.
 */
export const MAX_TRACKED_TECHNICAL_MESSAGES = 50;

/**
 * Register a bot message as technical — it will be deleted by the next
 * `cleanupTechnicalMessages` sweep. Returns the message id for convenience.
 */
export function trackTechnicalMessage(ctx: ContextWithSession, messageId: number): number {
  if (!ctx.session) return messageId;
  const ids = ctx.session.technicalMessages ?? [];
  if (!ids.includes(messageId)) {
    ids.push(messageId);
    if (ids.length > MAX_TRACKED_TECHNICAL_MESSAGES) {
      ids.splice(0, ids.length - MAX_TRACKED_TECHNICAL_MESSAGES);
    }
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

  // Telegram binds the persistent main-menu keyboard to the message that delivered
  // it, so deleting that message wipes the menu off the user's screen. The carrier
  // is never tracked as technical for exactly that reason; if it lands here anyway,
  // clear the delivery flag so `mainKeyboardMiddleware` re-installs the keyboard on
  // the next message instead of leaving the chat silently without a menu.
  const carrierId = ctx.session.mainKeyboardMessageId;
  if (carrierId !== undefined && ids.includes(carrierId)) {
    ctx.session.mainKeyboardVersion = undefined;
    ctx.session.mainKeyboardMessageId = undefined;
  }

  ctx.session.technicalMessages = [];
}

/**
 * Reply with a technical message and track it for the next sweep.
 *
 * This is the single supported way to send one: `ctx.reply` + a separate
 * `trackTechnicalMessage` call drifts apart the moment someone adds a new
 * branch. Use it for menus, prompts, hints, validation and error notices,
 * loading spinners and confirmations — never for translation cards, mentor
 * answers, notifications or video results.
 */
export async function replyTechnical(
  ctx: ContextWithSession,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
): Promise<ReturnType<Context["reply"]>> {
  // Forwarded exactly as given: a drop-in for `ctx.reply` must not turn a
  // one-argument call into a two-argument one.
  const msg = extra === undefined ? await ctx.reply(text) : await ctx.reply(text, extra);
  trackTechnicalMessage(ctx, msg.message_id);
  return msg;
}
