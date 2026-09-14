/**
 * Notification callback handlers — notif:* callbacks.
 *
 * Handles:
 * - notif:reveal:{entryId} → replace the nudge with the saved word's translation card
 * - notif:tr → translate the nudged word that has no saved entry to open
 * - notif:fb:{grade}:{entryId} → persist difficulty feedback (hard/normal/easy)
 * - notif:learned:{entryId} → soft-delete entry from vocabulary
 */
import { isSupported, logger, resolveTemplate, type SupportedLang, t } from "@polyglot/core";
import { renderTranslation } from "../renderers/translation.renderer.js";
import { buildCardKeyboard } from "../scenes/helpers/card-keyboard.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "../scenes/helpers/edit-message.helper.js";
import { handleTranslateText } from "../scenes/helpers/translate-flow.js";
import { setTranslationEntry } from "../scenes/helpers/translation-map.helper.js";
import type { BotContext } from "../types.js";
import { makeLangCodeResolver, resolveLanguageOrder } from "../utils/language-order.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, loadingKeyboard, withTimeout } from "../utils/long-op.js";
import { toTranslateOutput } from "../utils/vocabulary-mapper.js";
import { buildNotificationKeyboard, type NotifFeedbackGrade } from "./notification.formatter.js";

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
 * notif:reveal:{entryId} — hand over the answer.
 *
 * The nudge becomes the very card the word was translated on: the same renderer
 * and the same keyboard, so clarification, another meaning, grammar, etymology,
 * pronunciation and save all work here exactly as they do after a translation.
 * Rendering the stored entry a second way is what made this surface drift before.
 *
 * Those buttons address their card by message id, so the session entry is written
 * under the id the card actually landed on — past Telegram's 48-hour edit limit
 * the in-place edit is impossible and `editMessageTextOrReply` sends a fresh
 * message instead, which then owns the card.
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

    const output = entry ? toTranslateOutput(entry, makeLangCodeResolver(ctx)) : null;
    if (!entry || !output) {
      await ctx.answerCallbackQuery({ text: t("noResults", lang) });
      try {
        await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // Message might be too old
      }
      return;
    }

    const order = await resolveLanguageOrder(ctx);
    const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
    const template = resolveTemplate(savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null);
    const text = renderTranslation(output, order, lang, template.fields, order.nativeLang);

    const resent = await editMessageTextOrReply(ctx, text, { parse_mode: "HTML" });
    const cardMsgId = resent?.message_id ?? ctx.callbackQuery?.message?.message_id;
    if (cardMsgId === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }

    // The session entry first: the keyboard is derived from the card's own state,
    // which is what keeps this card's buttons identical to every other rebuild of
    // one (`card-keyboard.ts`) instead of a second hand-assembled guess at them.
    const cardEntry = {
      output,
      inputType: entry.inputType,
      savedWordId: entry.id,
      recallGrade: { entryId: entry.id, selected: entry.difficulty },
    };
    setTranslationEntry(ctx.session, cardMsgId, cardEntry);
    ctx.session.pendingCardMsgId = cardMsgId;

    // No native language on file leaves nothing to compare the source against,
    // which is the question the etymology and pronunciation rules ask.
    const keyboard = await buildCardKeyboard(ctx, cardEntry, cardMsgId, lang, order.nativeLang ?? output.sourceLang);
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, cardMsgId, { reply_markup: keyboard });
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
 * Mark the new grade on whichever keyboard the grade was tapped on: the nudge's,
 * or the translation card it was revealed into.
 *
 * A card whose session state was evicted still carries `tr:` buttons; rebuilding
 * the nudge keyboard there would throw the card's buttons away, so it keeps its
 * keyboard and the toast alone confirms the grade.
 */
async function remarkGrade(
  ctx: BotContext,
  lang: SupportedLang,
  entryId: number,
  grade: NotifFeedbackGrade,
): Promise<void> {
  const msgId = ctx.callbackQuery?.message?.message_id;
  const card = msgId === undefined ? undefined : ctx.session.translationMap?.[String(msgId)];
  if (msgId !== undefined && card?.recallGrade) {
    card.recallGrade = { entryId, selected: grade };
    const nativeLang = (await resolveLanguageOrder(ctx)).nativeLang ?? card.output.sourceLang;
    const keyboard = await buildCardKeyboard(ctx, card, msgId, lang, nativeLang);
    await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: keyboard });
    return;
  }
  const buttons = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard.flat() ?? [];
  if (buttons.some((button) => "callback_data" in button && button.callback_data?.startsWith("tr:"))) return;
  await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: buildNotificationKeyboard(lang, entryId, grade) });
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
      await remarkGrade(ctx, lang, entryId, grade);
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

    const removed = await withTimeout(
      ctx.services.vocabularyRepository.delete(entryId, ctx.user.id),
      LONG_OP_TIMEOUT_MS,
    );
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
    await editMessageTextOrReply(ctx, confirmation, { parse_mode: "HTML" });
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
