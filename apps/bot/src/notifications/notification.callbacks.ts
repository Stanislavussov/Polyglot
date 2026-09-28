/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:tr → translate the nudged word that has no saved entry to open
 * - notif:fb:{grade}:{entryId} → legacy difficulty grade from notifications sent before cards
 * - notif:learned:{entryId} → soft-delete entry from vocabulary
 * - notif:restore:{entryId} → bring a removed entry back
 * - notif:deck:{entryId} (and legacy notif:reveal:{entryId}) → open the notification as a Cards deck
 */
import {
  DEFAULT_NOTIFICATION_BATCH_SIZE,
  isSupported,
  logger,
  type SupportedLang,
  t,
  type VocabDifficulty,
} from "@polyglot/core";
import { esc } from "../renderers/card-sections.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "../scenes/helpers/edit-message.helper.js";
import { buildNotificationDeck, handleFcReveal } from "../scenes/helpers/flashcard.helper.js";
import { handleTranslateText } from "../scenes/helpers/translate-flow.js";
import { removeWord, restoreWord } from "../scenes/helpers/word-removal.js";
import type { BotContext } from "../types.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, loadingKeyboard, withTimeout } from "../utils/long-op.js";
import { buildNotificationKeyboard, buildNotificationRestoreKeyboard } from "./notification.formatter.js";

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
 * The headword the nudge showed, read off the message its button is attached to.
 *
 * Not off the callback data: a contextual pick is a whole sentence and Telegram
 * caps callback data at 64 bytes. The nudge renders exactly one bold span — the
 * headword — so the entity is an exact handle on it, offsets and all (Telegram
 * counts UTF-16 code units, which is what `String.slice` indexes by).
 */
function nudgedWord(ctx: BotContext): string | null {
  const message = ctx.callbackQuery?.message;
  const text = message && "text" in message ? message.text : undefined;
  const bold = message?.entities?.find((entity) => entity.type === "bold");
  if (!text || !bold) return null;
  return text.slice(bold.offset, bold.offset + bold.length).trim() || null;
}

/**
 * notif:tr — reveal a nudged word that was never saved (a curated pick, an AI
 * suggestion, a contextual sentence): there is no entry to open, so the word is
 * translated, which lands the reader on the same card with the same buttons —
 * save included, which is how the word gets into the dictionary at all.
 *
 * The button is dropped first: translating bills a model call, and a nudge left
 * tappable would bill one per tap.
 */
export async function handleNotifTranslateCallback(ctx: BotContext): Promise<void> {
  const word = nudgedWord(ctx);
  await ctx.answerCallbackQuery();
  if (!word) return;

  try {
    await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
  } catch {
    // Too old to edit — the translation below is what the tap was for.
  }
  await handleTranslateText(ctx, word);
}

const FEEDBACK_TOASTS: Record<VocabDifficulty, "notifFbHardDone" | "notifFbNormalDone" | "notifFbEasyDone"> = {
  hard: "notifFbHardDone",
  normal: "notifFbNormalDone",
  easy: "notifFbEasyDone",
};

function parseFeedback(data: string | undefined): { grade: VocabDifficulty; entryId: number } | null {
  const parts = data?.split(":") ?? [];
  const grade = parts[2];
  if (grade !== "hard" && grade !== "normal" && grade !== "easy") return null;
  const entryId = Number(parts[3]);
  return Number.isFinite(entryId) ? { grade, entryId } : null;
}

/**
 * An old nudge's grade buttons, tapped after notifications became cards: the tap is
 * honoured, and the message is upgraded to the card's buttons so it offers the four
 * ratings from here on. A revealed card (`tr:` buttons) keeps its own keyboard.
 */
async function upgradeGradedNudge(ctx: BotContext, lang: SupportedLang, entryId: number): Promise<void> {
  const buttons = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard.flat() ?? [];
  if (buttons.some((button) => "callback_data" in button && button.callback_data?.startsWith("tr:"))) return;
  await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: buildNotificationKeyboard(lang, entryId) });
}

/**
 * notif:fb:{grade}:{entryId} — the three grades notifications carried before they became
 * cards. Only buttons already in chat history send it; the grade is still stored.
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

    try {
      await upgradeGradedNudge(ctx, lang, entryId);
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
 * Soft-deletes the entry and replaces the message with a confirmation that offers it back.
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
    const word = esc(entry?.original ?? "?");

    const removed = await withTimeout(removeWord(ctx, entryId, "notification"), LONG_OP_TIMEOUT_MS);
    if (!removed) {
      // Already removed (from a card, say) or never this user's — nothing to confirm.
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      try {
        await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // Too old to edit — the toast already answered the tap.
      }
      return;
    }

    const confirmation = t("notifRemoved", lang, { word });
    await editMessageTextOrReply(ctx, confirmation, {
      parse_mode: "HTML",
      reply_markup: buildNotificationRestoreKeyboard(lang, entryId),
    });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to delete vocabulary entry from notification");
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

/**
 * notif:restore:{entryId} — undo a removal from the confirmation it left behind.
 * The question is gone with the message it replaced, so the word comes back under the
 * card's own buttons: reveal it, or remove it again.
 */
export async function handleNotifRestoreCallback(ctx: BotContext): Promise<void> {
  const entryId = parseEntryId(ctx.callbackQuery?.data);
  if (entryId == null) {
    await ctx.answerCallbackQuery();
    return;
  }

  let lang: SupportedLang = "en";
  let restored = false;
  try {
    const [, userLang, wasRestored] = await withTimeout(
      Promise.all([showLoadingKeyboard(ctx), getUserLang(ctx), restoreWord(ctx, entryId, "notification")]),
      LONG_OP_TIMEOUT_MS,
    );
    lang = userLang;
    restored = wasRestored;

    if (!restored) {
      // Already back (saved again from a card, say) or never this user's.
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      try {
        await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // Too old to edit — the toast already answered the tap.
      }
      return;
    }

    const entry = await withTimeout(ctx.services.vocabularyRepository.findById(entryId), LONG_OP_TIMEOUT_MS);
    await editMessageTextOrReply(ctx, t("notifRestored", lang, { word: esc(entry?.original ?? "?") }), {
      parse_mode: "HTML",
      reply_markup: buildNotificationKeyboard(lang, entryId),
    });
  } catch (err) {
    logger.error({ err, entryId }, "Failed to restore vocabulary entry from notification");
    try {
      // A failure past the restore itself leaves a live word: offering it back again would answer "no results".
      const keyboard = restored
        ? buildNotificationKeyboard(lang, entryId)
        : buildNotificationRestoreKeyboard(lang, entryId);
      await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: keyboard });
    } catch {
      // Restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();
}

/** `notif:reveal` is the Reveal of notifications sent before they became cards; it opens the same deck. */
export const NOTIF_DECK_PATTERN = /^notif:(?:deck|reveal):(\d+)$/;

/**
 * notif:deck:{entryId} — Reveal on a word notification, which is a card (one or several).
 *
 * From here the message *is* the Cards deck: the deck goes into the chat's one
 * `cards` slot and `handleFcReveal` answers the tap, so the ratings, the progress
 * line and the finish screen are the `/review` ones rather than a lookalike.
 * A running `/review` deck is replaced, exactly as a new deck from its own finish
 * screen would replace it.
 */
export async function handleNotifDeckCallback(ctx: BotContext): Promise<void> {
  const entryId = Number(ctx.match?.[1]);
  // A running /review deck survives a failed open: only a deck this tap installed is undone.
  const previous = ctx.session.cards;
  let lang: SupportedLang = "en";
  try {
    const [, settings] = await withTimeout(
      Promise.all([showLoadingKeyboard(ctx), ctx.services.userRepository.getSettings(ctx.user.id)]),
      LONG_OP_TIMEOUT_MS,
    );
    const interfaceLang = settings?.interfaceLang;
    lang = interfaceLang && isSupported(interfaceLang) ? interfaceLang : "en";
    // The size as it is now: a reader who just turned it down should get the smaller deck.
    const size = settings?.notificationBatchSize ?? DEFAULT_NOTIFICATION_BATCH_SIZE;
    const cards = await withTimeout(buildNotificationDeck(ctx, entryId, size), LONG_OP_TIMEOUT_MS);
    if (!cards) {
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      try {
        await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // Too old to edit — the toast already answered the tap.
      }
      return;
    }
    ctx.session.cards = cards;
    await handleFcReveal(ctx);
  } catch (err) {
    logger.error({ err, entryId }, "Failed to open the notification deck");
    ctx.session.cards = previous;
    try {
      await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: buildNotificationKeyboard(lang, entryId) });
    } catch {
      // Restore is best-effort; the alert below explains the failure.
    }
    try {
      await ctx.answerCallbackQuery({ text: failureAlertText(err, lang), show_alert: true });
    } catch {
      // The reveal may already have answered the tap before it failed.
    }
  }
}
