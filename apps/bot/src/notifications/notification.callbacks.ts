/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:open → show user's dictionary directly
 * - notif:skip → dismiss notification message
 */
import { logger } from "@polyglot/core";
import { handleDictionaryCommand } from "../scenes/dictionary.scene.js";
import type { BotContext } from "../types.js";

/**
 * notif:open — open dictionary.
 * Removes the notification keyboard and shows the dictionary directly.
 */
export async function handleNotifOpenCallback(ctx: BotContext): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    // Message might be too old — ignore
  }
  await ctx.answerCallbackQuery();

  try {
    await handleDictionaryCommand(ctx);
  } catch (err) {
    logger.error({ err }, "Failed to open dictionary after notification");
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
