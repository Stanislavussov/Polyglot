/**
 * Translate mode helper — handles text translation in persistent translate mode.
 * Called by the mode router when user is in translate mode.
 */
import { generateObject } from "@polyglot/adapter-ai";
import { userRepository, wordRepository } from "@polyglot/adapter-db";
import { translate, t, isSupported, type SupportedLang } from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import type { BotContext } from "../../types.js";
import {
  renderTranslation,
  buildTranslationKeyboard,
} from "../../renderers/translation.renderer.js";

/**
 * Handles a text message in translate mode.
 * Translates the text and shows the result with Save/Skip buttons.
 */
export async function handleTranslateText(
  ctx: BotContext,
  word: string,
): Promise<void> {
  const telegramId = ctx.from!.id;

  // Get user settings
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  if (learningLangs.length === 0) {
    await ctx.reply(t("translationUnavailable", lang));
    return;
  }

  // Show loading message
  const loadingMsg = await ctx.reply(t("translating", lang));

  try {
    const config = loadConfig();
    const output = await translate(
      {
        word,
        sourceLang: nativeLang,
        targetLangs: learningLangs,
        model: config.AI_MODEL,
        userId: ctx.user.id,
      },
      generateObject,
    );

    // Delete loading message
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Store pending translation in session for Save/Skip handling
    ctx.session.pendingTranslation = output;

    // Render and send translation card
    const langCodes = Object.keys(output.translations);
    const card = renderTranslation(output, lang);
    const keyboard = buildTranslationKeyboard(langCodes, lang);
    const cardMsg = await ctx.reply(card, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    // Store message ID for editing later
    ctx.session.pendingCardMsgId = cardMsg.message_id;
  } catch (err) {
    logger.error({ err, word, telegramId }, "Translation failed");
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(t("translationError", lang));
  }
}

/**
 * Handles Save callback in translate mode.
 */
export async function handleSaveCallback(ctx: BotContext): Promise<void> {
  const output = ctx.session.pendingTranslation;
  if (!output) {
    await ctx.answerCallbackQuery();
    return;
  }

  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Save to dictionary
  await wordRepository.create(ctx.user.id, {
    original: output.original,
    sourceLang: output.sourceLang,
    content: output,
  });

  // Update message with saved confirmation
  const saved = renderTranslation(output, lang) + "\n\n" + t("savedToDict", lang);
  await ctx.editMessageText(saved, { parse_mode: "HTML" });

  // Clear pending state and show hint
  ctx.session.pendingTranslation = undefined;
  ctx.session.pendingCardMsgId = undefined;

  await ctx.answerCallbackQuery();
  await ctx.reply(t("translateModeHint", lang));
}

/**
 * Handles Skip callback in translate mode.
 */
export async function handleSkipCallback(ctx: BotContext): Promise<void> {
  const output = ctx.session.pendingTranslation;
  if (!output) {
    await ctx.answerCallbackQuery();
    return;
  }

  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Remove keyboard, keep the card
  await ctx.editMessageText(renderTranslation(output, lang), {
    parse_mode: "HTML",
  });

  // Clear pending state and show hint
  ctx.session.pendingTranslation = undefined;
  ctx.session.pendingCardMsgId = undefined;

  await ctx.answerCallbackQuery();
  await ctx.reply(t("translateModeHint", lang));
}
