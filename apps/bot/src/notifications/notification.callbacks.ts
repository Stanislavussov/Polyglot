/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:reveal:{entryId} → show full dictionary card inline
 * - notif:fb:{grade}:{entryId} → persist difficulty feedback (hard/normal/easy)
 * - notif:learned:{entryId} → soft-delete entry from vocabulary
 */
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { renderDictionaryEntry } from "../renderers/dictionary.renderer.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "../scenes/helpers/edit-message.helper.js";
import type { BotContext } from "../types.js";
import { makeLangCodeResolver, resolveLanguageOrder } from "../utils/language-order.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, loadingKeyboard, withTimeout } from "../utils/long-op.js";
import {
  buildNotificationKeyboard,
  buildNotificationRevealedKeyboard,
  type NotifFeedbackGrade,
} from "./notification.formatter.js";

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
    await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: loadingKeyboard() });
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
        await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // Message might be too old
      }
      return;
    }

    const text = renderDictionaryEntry(entry, makeLangCodeResolver(ctx), lang, await resolveLanguageOrder(ctx));
    // Carry the stored grade so a rating given before Reveal keeps its ✓ mark.
    const kb = buildNotificationRevealedKeyboard(lang, entryId, entry.difficulty ?? undefined);

    await editMessageTextOrReply(ctx, text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to reveal notification card");
    try {
      await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: buildNotificationKeyboard(lang, entryId) });
    } catch {
      // Restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
}

const FEEDBACK_TOASTS: Record<NotifFeedbackGrade, "notifFbHardDone" | "notifFbNormalDone" | "notifFbEasyDone"> = {
  hard: "notifFbHardDone",
  normal: "notifFbNormalDone",
  easy: "notifFbEasyDone",
};

function parseFeedback(data: string | undefined): { grade: NotifFeedbackGrade; entryId: number } | null {
  const parts = data?.split(":") ?? [];
  const grade = parts[2];
  if (grade !== "hard" && grade !== "normal" && grade !== "easy") return null;
  const entryId = Number(parts[3]);
  return Number.isFinite(entryId) ? { grade, entryId } : null;
}

/**
 * The message this callback landed on may be in either state — freshly sent
 * (with the Reveal button) or already revealed. The button set is what tells
 * them apart, so re-render the same variant when marking the chosen grade.
 */
function messageHasRevealButton(ctx: BotContext): boolean {
  const rows = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard ?? [];
  return rows.some((row) => row.some((btn) => "callback_data" in btn && btn.callback_data.startsWith("notif:reveal:")));
}

/**
 * notif:fb:{grade}:{entryId} — persist the user's difficulty feedback.
 * The grade drives how often the word returns in notifications (hard → often,
 * easy → almost never). Answers with a toast and marks the chosen button.
 */
export async function handleNotifFeedbackCallback(ctx: BotContext): Promise<void> {
  const parsed = parseFeedback(ctx.callbackQuery?.data);
  if (!parsed) {
    await ctx.answerCallbackQuery();
    return;
  }
  const { grade, entryId } = parsed;

  let lang: SupportedLang = "en";
  try {
    const hadReveal = messageHasRevealButton(ctx);
    const [userLang, saved] = await withTimeout(
      Promise.all([getUserLang(ctx), ctx.services.vocabularyRepository.setDifficulty(entryId, ctx.user.id, grade)]),
      LONG_OP_TIMEOUT_MS,
    );
    lang = userLang;

    if (!saved) {
      // Entry deleted (or never this user's) — the buttons outlived the word.
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      return;
    }

    const kb = hadReveal
      ? buildNotificationKeyboard(lang, entryId, grade)
      : buildNotificationRevealedKeyboard(lang, entryId, grade);
    try {
      await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: kb });
    } catch {
      // >48h-old messages can't be edited — the toast still confirms the save.
    }
    await ctx.answerCallbackQuery({ text: t(FEEDBACK_TOASTS[grade], lang) });
  } catch (err) {
    logger.error({ err, entryId, grade }, "Failed to save notification feedback");
    await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
  }
}

/**
 * notif:learned:{entryId} — remove the word from the dictionary.
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
    await editMessageTextOrReply(ctx, confirmation, { parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to delete vocabulary entry from notification");
    try {
      await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: buildNotificationRevealedKeyboard(lang, entryId) });
    } catch {
      // Restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
}
