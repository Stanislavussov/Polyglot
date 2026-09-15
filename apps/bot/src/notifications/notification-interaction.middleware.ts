// Direct adapter import from a middleware (precedent: auth.ts): the delivery journal
// is adapter-db's alone, and the core service container does not carry it.
import { notificationDeliveryRepository } from "@polyglot/adapter-db";
import { errorFields, logEvent } from "@polyglot/core";
import type { NextFunction } from "grammy";
import type { BotContext } from "../types.js";

/**
 * Links every button tap on a journaled notification to its delivery row, so the
 * admin panel can tell who opened what. Runs after the handler so the tap's own
 * response is never delayed by the journal write.
 */
export async function notificationInteractionMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  try {
    await next();
  } finally {
    await recordTap(ctx);
  }
}

async function recordTap(ctx: BotContext): Promise<void> {
  const action = ctx.callbackQuery?.data;
  const message = ctx.callbackQuery?.message;
  // Auth skips updates without a sender, leaving ctx.user unset despite its type.
  const userId = (ctx.user as BotContext["user"] | undefined)?.id;
  // Notifications only ever go to the private chat, and message ids repeat across
  // chats — a group message with the same id must not count as an open.
  if (action === undefined || message?.chat.type !== "private" || userId === undefined) return;
  const telegramMessageId = message.message_id;

  try {
    const linked = await notificationDeliveryRepository.recordInteraction({ userId, telegramMessageId, action });
    if (linked) logEvent("notification.interaction", { deliveryId: linked.deliveryId, kind: linked.kind, action });
  } catch (err) {
    // Analytics only: a failed write must never surface as a failed tap.
    logEvent("notification.interaction_log_failed", { action, ...errorFields(err) }, "error");
  }
}
