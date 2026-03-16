/**
 * Translation scene — enter word → AI translate → regen/save/skip.
 */
import type { Conversation } from "@grammyjs/conversations";
import { userRepository } from "@polyglot/adapter-db";
import { generateObject } from "@polyglot/adapter-ai";
import { translate, t, isSupported, type TranslateOutput, type SupportedLang } from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import type { BotContext, ConversationContext } from "../types.js";
import { renderTranslation, buildTranslationKeyboard } from "../renderers/translation.renderer.js";
import { handleRegenLoop } from "./helpers/regen.helper.js";

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

  await ctx.reply(t("enterWordToTranslate", lang));
  const wordCtx = await conversation.waitFor("message:text", {
    otherwise: async (c) => { await c.reply(t("enterWordToTranslate", lang)); },
  });
  const word = wordCtx.message.text;

  const loadingMsg = await wordCtx.reply(t("translating", lang));

  let output: TranslateOutput;
  try {
    output = await conversation.external(async () => {
      const config = loadConfig();
      return translate(
        { word, sourceLang: nativeLang, targetLangs: learningLangs, model: config.AI_MODEL, userId },
        generateObject,
      );
    });
  } catch (err) {
    logger.error({ err, word }, "Translation failed");
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await wordCtx.reply(t("translationError", lang));
    return;
  }

  await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

  const langCodes = Object.keys(output.translations);
  const card = renderTranslation(output, lang);
  const keyboard = buildTranslationKeyboard(langCodes, lang);
  const cardMsg = await wordCtx.reply(card, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });

  await handleRegenLoop(conversation, ctx, output, lang, userId, cardMsg.message_id);
}
