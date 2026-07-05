/**
 * Out-of-set language handling (Fable T22/B2 slice (e)) — the callback handlers
 * for input in a language the user hasn't configured. `handleOutOfSetCallback`
 * completes the "add and translate" choice offered by `showAddLanguagePrompt`
 * (in `translate-mode.shared.ts`); `handleLangSelectCallback` resolves the
 * ambiguous-detection language buttons. Both hand off to the translation
 * pipeline via `handleMistypeConfirmCallback`.
 */
import {
  isSupported,
  isSupportedLanguage,
  logger,
  resolveDirectionFromSource,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { MAX_LEARNING_LANGS } from "../../constants.js";
import type { BotContext } from "../../types.js";
import { trackTechnicalMessage } from "../../utils/message-cleanup.js";
import { editMessageReplyMarkupOrIgnore } from "./edit-message.helper.js";
import { handleMistypeConfirmCallback } from "./translate-flow.js";
import { clearPendingClarification, getUserLanguageGroup, normalizeLearningLangs } from "./translate-mode.shared.js";

/**
 * Handles the out-of-set add-and-translate choice:
 *   tr:oos:add:<lang>  — add the language to the user's learning set, then translate
 *   tr:oos:once:<lang> — translate this once without persisting the language
 *   tr:oos:cancel      — dismiss
 */
export async function handleOutOfSetCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);

  const store = ctx.session.pendingOutOfSet ?? {};
  const promptMsgId = ctx.callbackQuery?.message?.message_id;
  const key = promptMsgId != null ? String(promptMsgId) : undefined;
  const pending = key ? store[key] : undefined;

  // Drop this prompt's pending entry and visually retire its keyboard so an
  // already-answered button can never fire again (T02).
  const settle = (): void => {
    if (key) delete store[key];
    ctx.session.pendingOutOfSet = store;
  };
  const removeKeyboard = (): Promise<void> => editMessageReplyMarkupOrIgnore(ctx);

  if (data === "tr:oos:cancel") {
    settle();
    await ctx.answerCallbackQuery();
    await removeKeyboard();
    const msg = await ctx.reply(t("translateModeHint", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  const isAdd = data.startsWith("tr:oos:add:");
  const isOnce = data.startsWith("tr:oos:once:");
  const sourceLang = data.replace(/^tr:oos:(?:add|once):/, "");

  // Stale/unknown button: no matching pending entry, wrong shape, or the button
  // language no longer matches the entry stored for this message.
  if (!pending || (!isAdd && !isOnce) || !isSupportedLanguage(sourceLang) || sourceLang !== pending.lang) {
    settle();
    await ctx.answerCallbackQuery({ text: t("staleSession", lang), show_alert: true });
    await removeKeyboard();
    return;
  }

  // "Add" persists the language into the learning set (unless already present).
  let effectiveLearning = learningLangs;
  const alreadyStudied = getUserLanguageGroup(nativeLang, learningLangs).includes(sourceLang);
  if (isAdd && !alreadyStudied) {
    // Explicit limit pre-check so a genuine DB failure is not masked as
    // "maximum languages reached" (the two are now distinct messages, T02).
    if (learningLangs.length >= MAX_LEARNING_LANGS) {
      await ctx.answerCallbackQuery({
        text: t("maxLangsReached", lang, { max: MAX_LEARNING_LANGS }),
        show_alert: true,
      });
      return;
    }
    const nextLangs = [...learningLangs, sourceLang];
    try {
      await ctx.services.userRepository.updateLearningLangs(ctx.user.id, nextLangs);
      effectiveLearning = nextLangs;
    } catch (err) {
      logger.warn({ err, sourceLang }, "Failed to add out-of-set language");
      await ctx.answerCallbackQuery({ text: t("translationError", lang), show_alert: true });
      return;
    }
  }

  const targetLangs = getUserLanguageGroup(nativeLang, effectiveLearning).filter((code) => code !== sourceLang);

  ctx.services.languageDetectionRepository
    .record({
      userId: ctx.user.id,
      eventType: isAdd ? "confirmed" : "detected",
      word: pending.word,
      sourceLang,
      targetLangs,
    })
    .catch((err: unknown) => {
      logger.warn({ err }, "Failed to record language detection event");
    });

  const pendingWord = pending.word;
  const pendingContextHint = pending.contextHint;
  settle();
  ctx.session.pendingDetectedLang = undefined;
  ctx.session.pendingWord = pendingWord;
  ctx.session.pendingContextHint = pendingContextHint;
  ctx.session.pendingDirection = { sourceLang, targetLangs };
  await ctx.answerCallbackQuery();
  await removeKeyboard();
  await handleMistypeConfirmCallback(ctx);
}

/**
 * Handles language selection callback (tr:langselect:$lang or tr:langselect:cancel).
 *
 * Fired when the user selects a source language from the ambiguous-detection
 * buttons. Resolves the translation direction from the selected language and
 * delegates to the mistype-confirm flow to run the translation pipeline.
 */
export async function handleLangSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  const selected = data.replace("tr:langselect:", "");

  if (selected === "cancel") {
    const pendingWord = ctx.session.pendingWord;
    ctx.session.pendingDetectedLang = undefined;
    ctx.session.pendingWord = undefined;
    ctx.session.pendingContextHint = undefined;
    ctx.session.pendingDirection = undefined;
    clearPendingClarification(ctx);

    if (pendingWord) {
      ctx.services.languageDetectionRepository
        .record({
          userId: ctx.user.id,
          eventType: "cancelled",
          word: pendingWord,
        })
        .catch((err: unknown) => {
          logger.warn({ err }, "Failed to record language detection event");
        });
    }

    const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

    await ctx.answerCallbackQuery();
    const msg = await ctx.reply(t("translateModeHint", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);

  const direction = resolveDirectionFromSource({
    sourceLang: selected,
    nativeLang,
    learningLangs,
  });

  if (!direction) {
    ctx.session.pendingDetectedLang = undefined;
    ctx.session.pendingWord = undefined;
    ctx.session.pendingContextHint = undefined;
    ctx.session.pendingDirection = undefined;
    clearPendingClarification(ctx);

    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired. Please translate the word again.",
      show_alert: true,
    });
    return;
  }

  ctx.session.pendingDirection = {
    sourceLang: direction.sourceLang,
    targetLangs: direction.targetLangs,
  };

  await handleMistypeConfirmCallback(ctx);
}
