/**
 * Regeneration loop helper for translate scene.
 * Handles per-language regeneration, save, and skip callbacks.
 * FEAT-30: save path uses FK resolution, dedup detection, and content sanitization.
 */
import type { Conversation } from "@grammyjs/conversations";
import { generateObject } from "@polyglot/adapter-ai";
import { getLang, wordRepository } from "@polyglot/adapter-db";
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
  buildPostSaveKeyboard,
  buildSentenceKeyboard,
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext, ConversationContext } from "../../types.js";
import { sanitizeForStorage } from "../../utils/sanitize-word-content.js";

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
  const buildKeyboard = isSentence
    ? buildSentenceKeyboard
    : (codes: string[], l: SupportedLang) => buildTranslationKeyboard(codes, (inputType as "word" | "phrase") ?? "word", l);
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
      // FEAT-30: FK resolution + dedup detection + sanitize
      const sourceLangEntry = getLang(current.sourceLang);
      const sourceLangId = sourceLangEntry?.id;

      if (!sourceLangId) {
        logger.error({ sourceLang: current.sourceLang }, "Source language not found in cache (regen loop)");
        continue;
      }

      // Duplicate detection
      const existing = await conversation.external(async () =>
        wordRepository.findByOriginalAndSource(userId, current.original, sourceLangId),
      );

      if (existing) {
        const alreadySavedMsg = t("alreadySaved", lang);
        await resp.answerCallbackQuery({ text: alreadySavedMsg, show_alert: true });
        continue;
      }

      // Sanitize + persist
      const sanitized = sanitizeForStorage(current);
      await conversation.external(async () => {
        await wordRepository.create(userId, {
          original: current.original,
          sourceLangId,
          inputType: (inputType as "word" | "phrase") ?? "word",
          content: sanitized,
        });
      });

      // Post-save card with regen-only keyboard
      const saved = `${renderCard(current, lang)}\n\n${t("savedToDict", lang)}`;
      const postSaveKb = buildPostSaveKeyboard(langCodes, lang);
      await resp.editMessageText(saved, { reply_markup: postSaveKb, parse_mode: "HTML" });
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
