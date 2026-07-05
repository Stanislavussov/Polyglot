/**
 * Regeneration loop helper for translate scene.
 * Handles per-language regeneration, save, and skip callbacks.
 * FEAT-30: save path uses FK resolution, dedup detection, and content sanitization.
 */
import type { Conversation } from "@grammyjs/conversations";
import { generateObject } from "@polyglot/adapter-ai";
import {
  type InputType,
  logger,
  resolveOutputConfig,
  resolveTemplate,
  type SupportedLang,
  type TranslateOutput,
  t,
  translateOne,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import {
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext, ConversationContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";

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
  nativeLang?: string,
): Promise<void> {
  const isSentence = inputType === "sentence";
  let current = output;
  const langCodes = Object.keys(current.translations);

  // Load user's template for template-aware output resolution (Task 32)
  const savedTpl = await conversation.external(async () =>
    ctx.services.translationTemplateRepository.getByUserId(userId),
  );
  const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);
  const outputConfig = resolveOutputConfig(
    userTpl,
    isSentence ? "sentence" : (inputType ?? "word"),
    output.original.length,
  );

  const renderCard = isSentence
    ? (o: TranslateOutput, l: SupportedLang) => renderSentenceTranslation(o, l, nativeLang)
    : (o: TranslateOutput, l: SupportedLang) => renderTranslation(o, l, effectiveTemplate.fields, nativeLang);
  const buildKeyboard = (_codes: string[], l: SupportedLang) => buildTranslationKeyboard(l);

  let card = renderCard(current, lang);
  let keyboard = buildKeyboard(langCodes, lang);

  const callbackPattern = /^tr:(save|skip|regen:.+)$/;

  while (true) {
    const resp = await conversation.waitUntil((ctx) => {
      const text = ctx.message?.text;
      if (text?.startsWith("/")) return false;
      const data = ctx.callbackQuery?.data ?? "";
      return callbackPattern.test(data);
    });
    await resp.answerCallbackQuery();
    if (!resp.callbackQuery?.data) {
      throw new Error("Unexpected missing callback query data in regen loop");
    }
    const data = resp.callbackQuery.data;

    if (data === "tr:save") {
      // FEAT-30: FK resolution + dedup detection + sanitize
      const sourceLangEntry = ctx.services.languageCache.getLang(current.sourceLang);
      const sourceLangId = sourceLangEntry?.id;

      if (!sourceLangId) {
        logger.error({ sourceLang: current.sourceLang }, "Source language not found in cache (regen loop)");
        continue;
      }

      // Duplicate detection
      const existing = await conversation.external(async () =>
        ctx.services.vocabularyRepository.findByOriginalAndSource(userId, current.original, sourceLangId),
      );

      if (existing) {
        const belongsToDefault = await conversation.external(async () =>
          ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(userId, existing.id),
        );
        if (!belongsToDefault) {
          await conversation.external(async () => {
            await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(userId, existing.id);
          });
          const saved = `${renderCard(current, lang)}\n\n${t("savedToDict", lang)}`;
          const postSaveKb = new InlineKeyboard();
          await resp.editMessageText(saved, { reply_markup: postSaveKb, parse_mode: "HTML" });
          return;
        }
        const alreadySavedMsg = t("alreadySaved", lang);
        await resp.answerCallbackQuery({ text: alreadySavedMsg, show_alert: true });
        continue;
      }

      // Map to normalized vocabulary input + persist
      const vocabInput = toVocabularyInput(
        current,
        sourceLangId,
        inputType ?? "word",
        (code) => ctx.services.languageCache.getLang(code)?.id ?? null,
      );
      await conversation.external(async () => {
        const newEntry = await ctx.services.vocabularyRepository.create(userId, vocabInput);
        await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(userId, newEntry.id);
      });

      // Post-save card with regen-only keyboard
      const saved = `${renderCard(current, lang)}\n\n${t("savedToDict", lang)}`;
      const postSaveKb = new InlineKeyboard();
      await resp.editMessageText(saved, { reply_markup: postSaveKb, parse_mode: "HTML" });
      return;
    }

    if (data === "tr:skip") {
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
      const regenDecision = await conversation.external(async () => {
        const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user?.subscriptionPlan);
        return translateOne(
          {
            word: current.original,
            sourceLang: current.sourceLang,
            targetLangs: [regenLang],
            targetLang: regenLang,
            model,
            userId,
            outputConfig,
            inputType,
          },
          generateObject,
        );
      });

      if (regenDecision.status === "needs_clarification") {
        throw new Error("Unexpected needs_clarification in regen loop");
      }

      const newTranslation = regenDecision.output.translations[regenLang];
      if (!newTranslation) {
        throw new Error(`Regen did not produce a translation for ${regenLang}`);
      }

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
