/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:reveal:{entryId} → show full dictionary card inline
 * - notif:learned:{entryId} → soft-delete entry from vocabulary
 */
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { renderDictionaryEntry } from "../renderers/dictionary.renderer.js";
import type { BotContext } from "../types.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, loadingKeyboard, withTimeout } from "../utils/long-op.js";
import { buildNotificationKeyboard, buildNotificationRevealedKeyboard } from "./notification.formatter.js";

function parseEntryId(data: string | undefined): number | null {
  if (!data) return null;
  const parts = data.split(":");
  if (!parts[2]) return null;
  const id = Number(parts[2]);
  return Number.isFinite(id) ? id : null;
}

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? (lang as SupportedLang) : "en";
}

/**
 * Swap the notification's buttons for the inert loading one while the entry
 * loads — on a cold Neon compute the reads alone can take seconds.
 * Best-effort: the operation proceeds even if the swap fails.
 */
async function showLoadingKeyboard(ctx: BotContext): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: loadingKeyboard() });
  } catch {
    // Message may be too old to edit — the loader is cosmetic.
  }
}

function failureAlertText(err: unknown, lang: SupportedLang): string {
  return isUserFacingTimeout(err) ? t("loadingTimeout", lang) : t("translationError", lang);
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

  let lang: SupportedLang = "en";
  try {
    // The loading swap runs in parallel with the two independent DB reads.
    const [, userLang, entry] = await withTimeout(
      Promise.all([showLoadingKeyboard(ctx), getUserLang(ctx), ctx.services.vocabularyRepository.findById(entryId)]),
      LONG_OP_TIMEOUT_MS,
    );
    lang = userLang;

    if (!entry) {
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      } catch {
        // Message might be too old
      }
      return;
    }

    const getLangCodeById = (id: number): string | undefined =>
      ctx.services.languageCache.getAllLangs().find((l) => l.id === id)?.code;
    const text = renderDictionaryEntry(entry, getLangCodeById, lang);
    const kb = buildNotificationRevealedKeyboard(lang, entryId);

    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to reveal notification card");
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: buildNotificationKeyboard(lang, entryId) });
    } catch {
      // Restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
    return;
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

  let lang: SupportedLang = "en";
  try {
    const [, userLang, entry] = await withTimeout(
      Promise.all([showLoadingKeyboard(ctx), getUserLang(ctx), ctx.services.vocabularyRepository.findById(entryId)]),
      LONG_OP_TIMEOUT_MS,
    );
    lang = userLang;
    const word = entry?.original ?? "?";

    await withTimeout(ctx.services.vocabularyRepository.delete(entryId, ctx.user.id), LONG_OP_TIMEOUT_MS);

    const confirmation = t("notifRemoved", lang, { word });
    await ctx.editMessageText(confirmation, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to delete vocabulary entry from notification");
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: buildNotificationRevealedKeyboard(lang, entryId) });
    } catch {
      // Restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
}
