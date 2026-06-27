/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:reveal:{entryId} → show full dictionary card inline
 * - notif:learned:{entryId} → soft-delete entry from vocabulary
 */
import { getAllLangs, userRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { renderDictionaryEntry } from "../renderers/dictionary.renderer.js";
import type { BotContext } from "../types.js";
import { buildNotificationRevealedKeyboard } from "./notification.formatter.js";

function getLangCodeById(id: number): string | undefined {
  const all = getAllLangs();
  return all.find((l) => l.id === id)?.code;
}

function parseEntryId(data: string | undefined): number | null {
  if (!data) return null;
  const parts = data.split(":");
  if (!parts[2]) return null;
  const id = Number(parts[2]);
  return Number.isFinite(id) ? id : null;
}

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? (lang as SupportedLang) : "en";
}

/**
 * notif:reveal:{entryId} — show full dictionary card.
 * Replaces the notification message with the full entry and a "Learned — remove" button.
 */
export async function handleNotifRevealCallback(ctx: BotContext): Promise<void> {
  const entryId = parseEntryId(ctx.callbackQuery?.data);
  if (entryId == null) {
    await ctx.answerCallbackQuery();
    return;
  }

  const lang = await getUserLang(ctx);

  try {
    const entry = await vocabularyRepository.findById(entryId);
    if (!entry) {
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      } catch {
        // Message might be too old
      }
      return;
    }

    const text = renderDictionaryEntry(entry, getLangCodeById, lang);
    const kb = buildNotificationRevealedKeyboard(lang, entryId);

    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to reveal notification card");
  }

  await ctx.answerCallbackQuery();
}

/**
 * notif:learned:{entryId} — mark as learned and remove from dictionary.
 * Soft-deletes the entry and replaces the message with a confirmation.
 */
export async function handleNotifLearnedCallback(ctx: BotContext): Promise<void> {
  const entryId = parseEntryId(ctx.callbackQuery?.data);
  if (entryId == null) {
    await ctx.answerCallbackQuery();
    return;
  }

  const lang = await getUserLang(ctx);

  try {
    const entry = await vocabularyRepository.findById(entryId);
    const word = entry?.original ?? "?";

    await vocabularyRepository.delete(entryId);

    const confirmation = t("notifRemoved", lang, { word });
    await ctx.editMessageText(confirmation, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to delete vocabulary entry from notification");
  }

  await ctx.answerCallbackQuery();
}
