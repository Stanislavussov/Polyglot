/**
 * Regeneration loop helper for translate scene.
 * Handles per-language regeneration, save, and skip callbacks.
 */
import type { Conversation } from "@grammyjs/conversations";
import { generateObject } from "@polyglot/adapter-ai";
import { wordRepository } from "@polyglot/adapter-db";
import { translateOne, t, type TranslateOutput, type SupportedLang } from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import type { BotContext, ConversationContext } from "../../types.js";
import {
  renderTranslation,
  buildTranslationKeyboard,
} from "../../renderers/translation.renderer.js";

type TranslateConversation = Conversation<BotContext, ConversationContext>;

/** Run the regeneration loop until user saves or skips. */
export async function handleRegenLoop(
  conversation: TranslateConversation,
  ctx: ConversationContext,
  output: TranslateOutput,
  lang: SupportedLang,
  userId: number,
  cardMsgId: number,
): Promise<void> {
  let current = output;
  const langCodes = Object.keys(current.translations);
  let card = renderTranslation(current, lang);
  let keyboard = buildTranslationKeyboard(langCodes, lang);

  while (true) {
    const resp = await conversation.waitForCallbackQuery(
      /^tr:(save|skip|regen:.+)$/,
      {
        otherwise: async (c) => {
          await c.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });
        },
      },
    );
    await resp.answerCallbackQuery();
    const data = resp.callbackQuery.data;

    if (data === "tr:save") {
      await conversation.external(async () => {
        await wordRepository.create(userId, {
          original: current.original,
          sourceLang: current.sourceLang,
          content: current,
        });
      });
      const saved = renderTranslation(current, lang) + "\n\n" + t("savedToDict", lang);
      await resp.editMessageText(saved, { parse_mode: "HTML" });
      return;
    }

    if (data === "tr:skip") {
      await resp.editMessageText(renderTranslation(current, lang), {
        parse_mode: "HTML",
      });
      return;
    }

    // Handle regeneration: tr:regen:<langCode>
    const regenLang = data.replace("tr:regen:", "");

    // Show loading state
    await resp.editMessageText(
      card + "\n\n" + t("regenerating", lang, { lang: regenLang.toUpperCase() }),
      { parse_mode: "HTML" },
    );

    try {
      const newTranslation = await conversation.external(async () => {
        const config = loadConfig();
        return translateOne(
          {
            word: current.original,
            sourceLang: current.sourceLang,
            targetLangs: [regenLang],
            targetLang: regenLang,
            model: config.AI_MODEL,
            userId,
          },
          generateObject,
        );
      });

      current = {
        ...current,
        translations: { ...current.translations, [regenLang]: newTranslation },
      };
    } catch (err) {
      logger.error({ err, word: current.original, regenLang }, "Regeneration failed");
    }

    // Re-render card and keyboard
    card = renderTranslation(current, lang);
    keyboard = buildTranslationKeyboard(langCodes, lang);
    await ctx.api.editMessageText(ctx.chat!.id, cardMsgId, card, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
}
