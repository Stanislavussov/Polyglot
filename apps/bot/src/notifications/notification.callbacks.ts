/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:open → deep-link to /dictionary
 * - notif:skip → dismiss notification message
 */
import { logger } from "@polyglot/infra";
import type { BotContext } from "../types.js";

/**
 * notif:open — open dictionary command.
 * Removes the notification keyboard and sends user to /dictionary.
 */
export async function handleNotifOpenCallback(ctx: BotContext): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    // Message might be too old — ignore
  }
  await ctx.answerCallbackQuery();

  // Trigger dictionary command by sending it as a message hint
  try {
    const chatId = ctx.from?.id;
    if (chatId) {
      await ctx.api.sendMessage(chatId, "/dictionary");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send /dictionary deep-link after notification open");
  }
}

/**
 * notif:skip — dismiss the notification.
 * Removes the keyboard from the notification message.
 */
export async function handleNotifSkipCallback(ctx: BotContext): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    // Message might be too old — ignore
  }
  await ctx.answerCallbackQuery();
}
