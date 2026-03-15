/**
 * Translation scene — user enters a word, gets AI translation,
 * can save to dictionary. Max 100 lines per bot agent rules.
 */
import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import { userRepository, wordRepository } from "@polyglot/adapter-db";
import { generateObject } from "@polyglot/adapter-ai";
import {
  translate,
  t,
  isSupported,
  type TranslateOutput,
  type SupportedLang,
} from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import type { BotContext, ConversationContext } from "../types.js";
import { renderTranslation } from "../renderers/translation.renderer.js";

type TranslateConversation = Conversation<BotContext, ConversationContext>;

export async function handleTranslate(
  conversation: TranslateConversation,
  ctx: ConversationContext,
): Promise<void> {
  const telegramId = ctx.from!.id;

  const { userId, lang, nativeLang, learningLangs } =
    await conversation.external(async () => {
      const user = await userRepository.findByTelegramId(telegramId);
      if (!user) throw new Error("User not found");
      const settings = await userRepository.getSettings(user.id);
      const iLang = settings?.interfaceLang ?? "en";
      return {
        userId: user.id,
        lang: (isSupported(iLang) ? iLang : "en") as SupportedLang,
        nativeLang: settings?.nativeLang ?? "en",
        learningLangs: settings?.learningLangs ?? [],
      };
    });

  if (learningLangs.length === 0) {
    await ctx.reply(t("translationUnavailable", lang));
    return;
  }

  // Prompt for word
  await ctx.reply(t("enterWordToTranslate", lang));
  const wordCtx = await conversation.waitFor("message:text", {
    otherwise: async (c) => {
      await c.reply(t("enterWordToTranslate", lang));
    },
  });
  const word = wordCtx.message.text;

  // Show loading indicator
  let loadingMsg;
  try {
    loadingMsg = await wordCtx.reply(t("translating", lang));
  } catch (err) {
    logger.error({ err, telegramId }, "Failed to send loading message");
    throw err;
  }

  // Call translation pipeline
  let output: TranslateOutput;
  try {
    output = await conversation.external(async () => {
      const config = loadConfig();
      return translate(
        {
          word,
          sourceLang: nativeLang,
          targetLangs: learningLangs,
          model: config.AI_MODEL,
          userId,
        },
        generateObject,
      );
    });
  } catch (err) {
    logger.error({ err, word }, "Translation failed");
    await ctx.api
      .deleteMessage(ctx.chat!.id, loadingMsg.message_id)
      .catch(() => {});
    await wordCtx.reply(t("translationError", lang));
    return;
  }

  // Delete loading message, show result
  await ctx.api
    .deleteMessage(ctx.chat!.id, loadingMsg.message_id)
    .catch(() => {});

  const card = renderTranslation(output, lang);
  const keyboard = new InlineKeyboard()
    .text(t("saveToDictionary", lang), "tr:save")
    .text(t("no", lang), "tr:skip");

  await wordCtx.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });

  // Wait for save/skip decision
  const resp = await conversation.waitForCallbackQuery(/^tr:/, {
    otherwise: async (c) => {
      await c.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });
    },
  });
  await resp.answerCallbackQuery();

  if (resp.callbackQuery.data === "tr:save") {
    await conversation.external(async () => {
      await wordRepository.create(userId, {
        original: output.original,
        sourceLang: output.sourceLang,
        content: output,
      });
    });
    const saved = card + "\n\n" + t("savedToDict", lang);
    await resp.editMessageText(saved, { parse_mode: "HTML" });
  } else {
    await resp.editMessageText(card, { parse_mode: "HTML" });
  }
}
