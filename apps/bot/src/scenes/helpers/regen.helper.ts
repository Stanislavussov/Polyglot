/**
 * Regeneration loop helper for translate scene.
 * Handles per-language regeneration, save, and skip callbacks.
 */
import type { Conversation } from "@grammyjs/conversations";
import { generateObject } from "@polyglot/adapter-ai";
import { wordRepository } from "@polyglot/adapter-db";
import {
  FULL_OUTPUT,
  type InputType,
  SENTENCE_OUTPUT,
  type SupportedLang,
  type TranslateOutput,
  t,
  translateOne,
} from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import {
  buildSentenceKeyboard,
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext, ConversationContext } from "../../types.js";

type TranslateConversation = Conversation<BotContext, ConversationContext>;

/** Run the regeneration loop until user saves or skips. */
export async function handleRegenLoop(
  conversation: TranslateConversation,
  ctx: ConversationContext,
  output: TranslateOutput,
  lang: SupportedLang,
  userId: number,
  cardMsgId: number,
  inputType?: InputType,
): Promise<void> {
  const isSentence = inputType === "sentence";
  let current = output;
  const langCodes = Object.keys(current.translations);
  const renderCard = isSentence ? renderSentenceTranslation : renderTranslation;
  const buildKeyboard = isSentence ? buildSentenceKeyboard : buildTranslationKeyboard;
  const outputConfig = isSentence ? SENTENCE_OUTPUT : FULL_OUTPUT;

  let card = renderCard(current, lang);
  let keyboard = buildKeyboard(langCodes, lang);

  // For sentences, only support regen — no save/skip
  const callbackPattern = isSentence
    ? /^tr:regen:.+$/
    : /^tr:(save|skip|regen:.+)$/;

  while (true) {
    const resp = await conversation.waitForCallbackQuery(callbackPattern, {
      otherwise: async (c) => {
        await c.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });
      },
    });
    await resp.answerCallbackQuery();
    const data = resp.callbackQuery.data;

    if (!isSentence && data === "tr:save") {
      await conversation.external(async () => {
        await wordRepository.create(userId, {
          original: current.original,
          sourceLang: current.sourceLang,
          content: current,
        });
      });
      const saved = `${renderCard(current, lang)}\n\n${t("savedToDict", lang)}`;
      await resp.editMessageText(saved, { parse_mode: "HTML" });
      return;
    }

    if (!isSentence && data === "tr:skip") {
      await resp.editMessageText(renderCard(current, lang), {
        parse_mode: "HTML",
      });
      return;
    }

    // Handle regeneration: tr:regen:<langCode>
    const regenLang = data.replace("tr:regen:", "");

    // Show loading state
    await resp.editMessageText(`${card}\n\n${t("regenerating", lang, { lang: regenLang.toUpperCase() })}`, {
      parse_mode: "HTML",
    });

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
            outputConfig,
            inputType,
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
    card = renderCard(current, lang);
    keyboard = buildKeyboard(langCodes, lang);
    await ctx.api.editMessageText(ctx.chat!.id, cardMsgId, card, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
}
