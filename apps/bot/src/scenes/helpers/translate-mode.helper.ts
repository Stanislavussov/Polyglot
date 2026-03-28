/**
 * Translate mode helper — handles text translation in persistent translate mode.
 * Called by the mode router when user is in translate mode.
 */
import { generateObject } from "@polyglot/adapter-ai";
import { createContextLookup, getLang, userRepository, wordRepository } from "@polyglot/adapter-db";
import {
  FULL_OUTPUT,
  getLangDisplay,
  getLanguageName,
  isSupported,
  resolveDirectionFromSource,
  resolveTranslationDirection,
  SENTENCE_OUTPUT,
  type SupportedLang,
  t,
  translateOneWithContext,
  translateWithContext,
} from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import {
  buildPostSaveKeyboard,
  buildSentenceKeyboard,
  buildSourceLangKeyboard,
  buildTranslationKeyboard,
  type LangOption,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { classifyInput } from "../../utils/classify-input.js";
import { sanitizeForStorage } from "../../utils/sanitize-word-content.js";

/** Singleton lookup function — created once and reused. */
const lookupContext = createContextLookup();

/**
 * Handles a text message in translate mode.
 * Translates the text and shows the result with Save/Skip buttons.
 */
export async function handleTranslateText(ctx: BotContext, word: string): Promise<void> {
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

  // Resolve translation direction:
  // 1. If nextSourceLang is set → use explicit source (Task 17)
  // 2. Otherwise → auto-detect input language (Task 16)
  let sourceLang: string;
  let targetLangs: string[];
  let detectedLang: string | undefined;

  const nextSource = ctx.session.nextSourceLang;
  if (nextSource) {
    // Explicit source language from user selection
    const direction = resolveDirectionFromSource({
      sourceLang: nextSource,
      nativeLang,
      learningLangs,
    });

    if (direction) {
      sourceLang = direction.sourceLang;
      targetLangs = direction.targetLangs;
      detectedLang = undefined; // no detection needed
    } else {
      // Selected source lang no longer in config — reset and fall back
      ctx.session.nextSourceLang = null;
      const fallback = resolveTranslationDirection({
        text: word,
        nativeLang,
        learningLangs,
      });
      sourceLang = fallback.sourceLang;
      targetLangs = fallback.targetLangs;
      detectedLang = fallback.detectedLang;
    }
  } else {
    // Auto-detect input language (default / first translation)
    const direction = resolveTranslationDirection({
      text: word,
      nativeLang,
      learningLangs,
    });
    sourceLang = direction.sourceLang;
    targetLangs = direction.targetLangs;
    detectedLang = direction.detectedLang;
  }

  // Classify input type
  const classification = classifyInput(word);
  const isSentence = classification.type === "sentence";

  logger.debug(
    { word, detectedLang, sourceLang, targetLangs, nextSourceLang: nextSource ?? null, inputType: classification.type, wordCount: classification.wordCount },
    "Resolved translation direction",
  );

  // Show loading message
  const loadingMsg = await ctx.reply(t("translating", lang));

  try {
    const config = loadConfig();

    // Select output preset based on input type
    const outputConfig = isSentence ? SENTENCE_OUTPUT : FULL_OUTPUT;

    // For sentences, skip dictionary context lookup (no learnable word to enrich)
    const lookupContextFn = isSentence
      ? async () => undefined
      : lookupContext;

    const output = await translateWithContext(
      {
        word,
        sourceLang,
        targetLangs,
        model: config.AI_MODEL,
        userId: ctx.user.id,
        outputConfig,
        inputType: classification.type,
      },
      { lookupContext: lookupContextFn, generateObjectFn: generateObject },
    );

    // Delete loading message
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Reset savedWordId on every new translation
    ctx.session.savedWordId = undefined;

    // Store last translation + input type for regen
    ctx.session.lastTranslation = output;
    ctx.session.lastInputType = classification.type;

    const langCodes = Object.keys(output.translations);

    if (isSentence) {
      // Sentence: compact card, regen-only keyboard, no Save/Skip, no pendingTranslation
      let card = `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang)}`;

      // Show detected language when it differs from native
      if (detectedLang && detectedLang !== nativeLang) {
        const displayName = getLanguageName(detectedLang, lang);
        card = `${t("detectedLang", lang, { lang: displayName })}\n${card}`;
      }

      const keyboard = buildSentenceKeyboard(langCodes, lang);
      await ctx.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });

      // No pendingTranslation for sentences — nothing to save
      ctx.session.pendingTranslation = undefined;
      ctx.session.pendingCardMsgId = undefined;

      // Show source language selection menu
      await sendSourceLangMenu(ctx, settings, lang);
    } else {
      // Word/phrase: full card with Save/Skip/Regen keyboard
      ctx.session.pendingTranslation = output;

      let card = renderTranslation(output, lang);

      // Show detected language when it differs from native (i.e., reversed direction)
      if (detectedLang && detectedLang !== nativeLang) {
        const displayName = getLanguageName(detectedLang, lang);
        card = `${t("detectedLang", lang, { lang: displayName })}\n${card}`;
      }

      const keyboard = buildTranslationKeyboard(langCodes, classification.type as "word" | "phrase", lang);
      const cardMsg = await ctx.reply(card, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });

      // Store message ID for editing later
      ctx.session.pendingCardMsgId = cardMsg.message_id;

      // Show source language selection menu immediately after translation
      await sendSourceLangMenu(ctx, settings, lang);
    }
  } catch (err) {
    logger.error({ err, word, telegramId }, "Translation failed");
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(t("translationError", lang));
  }
}

/**
 * Handles Save callback in translate mode — full FEAT-30 flow.
 * FK resolution → duplicate detection → sanitize → persist → edit card.
 */
export async function handleSaveCallback(ctx: BotContext): Promise<void> {
  const output = ctx.session.pendingTranslation;
  const inputType = ctx.session.lastInputType;
  if (!output) {
    logger.warn({ userId: ctx.from?.id }, "Save clicked but pendingTranslation is empty (session lost?)");
    await ctx.answerCallbackQuery({ text: "⚠️ Session expired. Please translate the word again.", show_alert: true });
    return;
  }

  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Step 2 — FK resolution
  const sourceLangEntry = getLang(output.sourceLang);
  if (!sourceLangEntry) {
    logger.error({ sourceLang: output.sourceLang }, "Source language not found in cache");
    await ctx.answerCallbackQuery({ text: t("translationError", lang) });
    return;
  }
  const sourceLangId = sourceLangEntry.id;

  // Step 3 — Duplicate detection
  const existing = await wordRepository.findByOriginalAndSource(ctx.user.id, output.original, sourceLangId);
  if (existing) {
    await ctx.answerCallbackQuery({ text: t("alreadySaved", lang), show_alert: true });
    return;
  }

  // Step 4 — Sanitize
  const content = sanitizeForStorage(output);

  // Step 5 — Persist
  const newEntry = await wordRepository.create(ctx.user.id, {
    original: output.original,
    sourceLangId,
    inputType: (inputType as "word" | "phrase") ?? "word",
    content,
  });

  // Step 6 — Session update
  ctx.session.savedWordId = newEntry.id;
  ctx.session.pendingTranslation = undefined;
  ctx.session.pendingCardMsgId = undefined;

  // Step 7 — Edit card in place
  const langCodes = Object.keys(output.translations);
  const savedCard = `${renderTranslation(output, lang)}\n\n${t("savedToDict", lang)}`;
  const keyboard = buildPostSaveKeyboard(langCodes, lang);
  try {
    await ctx.editMessageText(savedCard, { reply_markup: keyboard, parse_mode: "HTML" });
  } catch (err) {
    logger.error({ err }, "Failed to edit message after save — save still succeeded");
  }

  // Step 8
  await ctx.answerCallbackQuery();
}

/**
 * Handles Skip callback in translate mode.
 */
export async function handleSkipCallback(ctx: BotContext): Promise<void> {
  const output = ctx.session.pendingTranslation;
  if (!output) {
    await ctx.answerCallbackQuery({ text: "⚠️ Session expired. Please translate the word again.", show_alert: true });
    return;
  }

  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Remove keyboard, keep the card
  await ctx.editMessageText(renderTranslation(output, lang), {
    parse_mode: "HTML",
  });

  // Clear pending state
  ctx.session.pendingTranslation = undefined;
  ctx.session.pendingCardMsgId = undefined;

  await ctx.answerCallbackQuery();

  // Show hint + source language selection menu
  await sendSourceLangMenu(ctx, settings, lang);
}

/**
 * Build language options from user settings for the source lang keyboard.
 */
export function buildLangOptions(
  nativeLang: string,
  learningLangs: string[],
  _interfaceLang: SupportedLang,
): LangOption[] {
  const allLangs = [nativeLang, ...learningLangs];
  return allLangs.map((code) => ({
    code,
    name: getLangDisplay(code),
  }));
}

/**
 * Send the source language selection menu after Save/Skip.
 * Includes the hint text + nextTranslationFrom header + inline keyboard.
 * Falls back to plain hint when user has only 2 languages.
 */
async function sendSourceLangMenu(
  ctx: BotContext,
  settings: { nativeLang?: string; learningLangs?: string[]; interfaceLang?: string } | null,
  lang: SupportedLang,
): Promise<void> {
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  const langOptions = buildLangOptions(nativeLang, learningLangs, lang);
  const keyboard = buildSourceLangKeyboard(langOptions, ctx.session.nextSourceLang ?? null);

  if (keyboard) {
    const text = `${t("translateModeHint", lang)}\n\n${t("nextTranslationFrom", lang)}`;
    await ctx.reply(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(t("translateModeHint", lang));
  }
}

/**
 * Handles regeneration callback in persistent translate mode (tr:regen:{code}).
 * Reads lastTranslation and lastInputType from session to select the
 * correct preset, renderer, and keyboard.
 * When savedWordId is set, auto-updates the stored DB entry after regen.
 */
export async function handleRegenCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  const regenLang = data.replace("tr:regen:", "");
  const lastOutput = ctx.session.lastTranslation;
  if (!lastOutput) {
    await ctx.answerCallbackQuery();
    return;
  }

  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const isSentence = ctx.session.lastInputType === "sentence";
  const inputType = ctx.session.lastInputType;

  // Show regenerating indicator
  await ctx.answerCallbackQuery({
    text: t("regenerating", lang, { lang: regenLang.toUpperCase() }),
  });

  try {
    const config = loadConfig();
    const outputConfig = isSentence ? SENTENCE_OUTPUT : FULL_OUTPUT;

    // For sentences, skip dictionary context lookup
    const lookupContextFn = isSentence
      ? async () => undefined
      : lookupContext;

    const newTranslation = await translateOneWithContext(
      {
        word: lastOutput.original,
        sourceLang: lastOutput.sourceLang,
        targetLangs: [regenLang],
        targetLang: regenLang,
        model: config.AI_MODEL,
        userId: ctx.user.id,
        outputConfig,
        inputType,
      },
      { lookupContext: lookupContextFn, generateObjectFn: generateObject },
    );

    // Merge regenerated translation
    const updated: typeof lastOutput = {
      ...lastOutput,
      translations: { ...lastOutput.translations, [regenLang]: newTranslation },
    };
    ctx.session.lastTranslation = updated;

    // Auto-update saved DB entry when savedWordId is set
    if (ctx.session.savedWordId) {
      try {
        const sanitized = sanitizeForStorage(updated);
        await wordRepository.updateContent(ctx.session.savedWordId, sanitized);
      } catch (err) {
        logger.error({ err, savedWordId: ctx.session.savedWordId }, "Failed to update saved word after regen");
      }
    }

    // Also update pendingTranslation for word/phrase (Save/Skip still works)
    // Only when word is NOT yet saved (pendingTranslation was cleared on save)
    if (!isSentence && !ctx.session.savedWordId) {
      ctx.session.pendingTranslation = updated;
    }

    // Re-render card with correct renderer and keyboard
    const langCodes = Object.keys(updated.translations);

    if (isSentence) {
      const card = `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(updated, lang)}`;
      const keyboard = buildSentenceKeyboard(langCodes, lang);
      await ctx.editMessageText(card, { reply_markup: keyboard, parse_mode: "HTML" });
    } else if (ctx.session.savedWordId) {
      // Post-save: regen-only keyboard + saved indicator
      const card = `${renderTranslation(updated, lang)}\n\n${t("savedToDict", lang)}`;
      const keyboard = buildPostSaveKeyboard(langCodes, lang);
      await ctx.editMessageText(card, { reply_markup: keyboard, parse_mode: "HTML" });
    } else {
      const card = renderTranslation(updated, lang);
      const keyboard = buildTranslationKeyboard(langCodes, (inputType as "word" | "phrase") ?? "word", lang);
      await ctx.editMessageText(card, { reply_markup: keyboard, parse_mode: "HTML" });
    }
  } catch (err) {
    logger.error({ err, word: lastOutput.original, regenLang }, "Regeneration failed");
  }
}

/**
 * Handles source language selection callback (tr:srclang:{code}).
 * Sets nextSourceLang in session, answers with confirmation, updates keyboard.
 */
export async function handleSourceLangCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  const code = data.replace("tr:srclang:", "");

  // Set the selected source language in session
  ctx.session.nextSourceLang = code;

  // Get user settings for language display
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = settings?.learningLangs ?? [];

  // Answer callback with confirmation
  const displayName = getLanguageName(code, lang);
  await ctx.answerCallbackQuery({
    text: t("nextSourceSet", lang, { lang: displayName }),
  });

  // Update keyboard in-place to reflect new selection
  const langOptions = buildLangOptions(nativeLang, learningLangs, lang);
  const keyboard = buildSourceLangKeyboard(langOptions, code);

  if (keyboard) {
    const text = `${t("translateModeHint", lang)}\n\n${t("nextTranslationFrom", lang)}`;
    await ctx.editMessageText(text, { reply_markup: keyboard });
  }
}
