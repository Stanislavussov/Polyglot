/**
 * Out-of-set language handling (Fable T22/B2 slice (e)) — the callback handlers
 * for input in a language the user hasn't configured. `handleOutOfSetCallback`
 * completes the "add and translate" choice offered by `showAddLanguagePrompt`
 * (in `translate-mode.shared.ts`); `handleLangSelectCallback` resolves the
 * ambiguous-detection language buttons. Both hand off to the translation
 * pipeline via `handleMistypeConfirmCallback`.
 */
import {
  errorFields,
  isSupported,
  isSupportedLanguage,
  logEvent,
  resolveDirectionFromSource,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { MAX_LEARNING_LANGS } from "../../constants.js";
import { clearRequestSettings } from "../../middlewares/request-settings.js";
import type { BotContext } from "../../types.js";
import { replyTechnical } from "../../utils/message-cleanup.js";
import { editMessageReplyMarkupOrIgnore } from "./edit-message.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";
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
    await replyTechnical(ctx, t("translateModeHint", lang));
    return;
  }

  const isAdd = data.startsWith("tr:oos:add:");
  const isOnce = data.startsWith("tr:oos:once:");
  const sourceLang = data.replace(/^tr:oos:(?:add|once):/, "");

  // Stale/unknown button: no matching pending entry, wrong shape, or the button
  // language no longer matches the entry stored for this message.
  if (!pending || (!isAdd && !isOnce) || !isSupportedLanguage(sourceLang) || sourceLang !== pending.lang) {
    settle();
    await removeKeyboard();
    await answerStaleCallback(ctx, {
      action: "tr:oos",
      lang,
      ...(pending?.word !== undefined && { word: pending.word }),
    });
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
      logEvent("language.added_from_out_of_set", { sourceLang, learningLangs: nextLangs });
      // This update continues into `handleMistypeConfirmCallback` below, which
      // re-reads the settings. Drop the request memo (warmed by the auth
      // middleware before this write) so that read sees the language just added
      // instead of re-classifying it as out-of-set and re-offering it.
      clearRequestSettings(ctx);
    } catch (err) {
      logEvent("language.add_from_out_of_set_failed", { sourceLang, ...errorFields(err) }, "warn");
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
      logEvent("language_detection.record_failed", errorFields(err), "warn");
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
          logEvent("language_detection.record_failed", errorFields(err), "warn");
        });
    }

    const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

    await ctx.answerCallbackQuery();
    await replyTechnical(ctx, t("translateModeHint", lang));
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
    // Read the pending input before the reset below wipes it — it is what lets
    // the stale answer offer a retry instead of a dead end.
    const pendingWord = ctx.session.pendingWord;
    const pendingContextHint = ctx.session.pendingContextHint;
    ctx.session.pendingDetectedLang = undefined;
    ctx.session.pendingWord = undefined;
    ctx.session.pendingContextHint = undefined;
    ctx.session.pendingDirection = undefined;
    clearPendingClarification(ctx);

    await answerStaleCallback(ctx, {
      action: "tr:langselect",
      ...(pendingWord !== undefined && { word: pendingWord }),
      ...(pendingContextHint !== undefined && { contextHint: pendingContextHint }),
    });
    return;
  }

  ctx.session.pendingDirection = {
    sourceLang: direction.sourceLang,
    targetLangs: direction.targetLangs,
  };

  await handleMistypeConfirmCallback(ctx);
}

/**
 * Handles the doubtful-source override callback (tr:srclang:<code>:<mid>).
 *
 * Shown only on cards whose source language was a heuristic guess. The user taps
 * a flag to force the source language; we recover the original text from the
 * card's session entry, resolve the direction from the forced source, and hand
 * off to the mistype-confirm pipeline — which sends a NEW card (leaving the
 * doubtful card as a snapshot) and never re-shows the override menu.
 */
export async function handleSrcLangOverrideCallback(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const forcedSource = parts[2] ?? "";
  const msgId = parts[3] ?? "";

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  const entry = ctx.session.translationMap?.[msgId];
  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:srclang", msgId, lang });
    return;
  }

  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);
  const direction = resolveDirectionFromSource({ sourceLang: forcedSource, nativeLang, learningLangs });

  // Defensive: the offered flags are drawn from the user's own native + learning
  // set, so a null direction should not happen — but never crash if it does.
  if (!direction) {
    await ctx.answerCallbackQuery({ text: t("staleSession", lang), show_alert: true });
    return;
  }

  ctx.services.languageDetectionRepository
    .record({
      userId: ctx.user.id,
      eventType: "override_used",
      word: entry.output.original,
      sourceLang: direction.sourceLang,
      targetLangs: direction.targetLangs,
    })
    .catch((err: unknown) => {
      logEvent("language_detection.record_failed", errorFields(err), "warn");
    });

  ctx.session.pendingDetectedLang = undefined;
  ctx.session.pendingWord = entry.output.original;
  ctx.session.pendingContextHint = entry.contextHint;
  ctx.session.pendingDirection = {
    sourceLang: direction.sourceLang,
    targetLangs: direction.targetLangs,
  };

  await handleMistypeConfirmCallback(ctx);
}
