/**
 * Translate mode helper — handles text translation in persistent translate mode.
 * Called by the mode router when user is in translate mode.
 */
import { generateObject } from "@polyglot/adapter-ai";
import { userRepository, wordRepository, createContextLookup } from "@polyglot/adapter-db";
import {
  translateWithContext,
  resolveTranslationDirection,
  resolveDirectionFromSource,
  t,
  getLanguageName,
  getLangDisplay,
  isSupported,
  type SupportedLang,
} from "@polyglot/core";
import { loadConfig, logger } from "@polyglot/infra";
import type { BotContext } from "../../types.js";
import {
  renderTranslation,
  buildTranslationKeyboard,
  buildSourceLangKeyboard,
  type LangOption,
} from "../../renderers/translation.renderer.js";

/** Singleton lookup function — created once and reused. */
const lookupContext = createContextLookup();

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

  logger.debug(
    { word, detectedLang, sourceLang, targetLangs, nextSourceLang: nextSource ?? null },
    "Resolved translation direction",
  );

  // Show loading message
  const loadingMsg = await ctx.reply(t("translating", lang));

  try {
    const config = loadConfig();

    const output = await translateWithContext(
      {
        word,
        sourceLang,
        targetLangs,
        model: config.AI_MODEL,
        userId: ctx.user.id,
      },
      { lookupContext, generateObjectFn: generateObject },
    );

    // Delete loading message
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Store pending translation in session for Save/Skip handling
    ctx.session.pendingTranslation = output;

    // Render and send translation card
    const langCodes = Object.keys(output.translations);
    let card = renderTranslation(output, lang);

    // Show detected language when it differs from native (i.e., reversed direction)
    if (detectedLang && detectedLang !== nativeLang) {
      const displayName = getLanguageName(detectedLang, lang);
      card = t("detectedLang", lang, { lang: displayName }) + "\n" + card;
    }

    const keyboard = buildTranslationKeyboard(langCodes, lang);
    const cardMsg = await ctx.reply(card, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });

    // Store message ID for editing later
    ctx.session.pendingCardMsgId = cardMsg.message_id;

    // Show source language selection menu immediately after translation
    await sendSourceLangMenu(ctx, settings, lang);
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

  // Clear pending state
  ctx.session.pendingTranslation = undefined;
  ctx.session.pendingCardMsgId = undefined;

  await ctx.answerCallbackQuery();

  // Show hint + source language selection menu
  await sendSourceLangMenu(ctx, settings, lang);
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
  interfaceLang: SupportedLang,
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
  const keyboard = buildSourceLangKeyboard(
    langOptions,
    ctx.session.nextSourceLang ?? null,
  );

  if (keyboard) {
    const text =
      t("translateModeHint", lang) + "\n\n" + t("nextTranslationFrom", lang);
    await ctx.reply(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(t("translateModeHint", lang));
  }
}

/**
 * Handles source language selection callback (tr:srclang:{code}).
 * Sets nextSourceLang in session, answers with confirmation, updates keyboard.
 */
export async function handleSourceLangCallback(
  ctx: BotContext,
): Promise<void> {
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
    const text =
      t("translateModeHint", lang) + "\n\n" + t("nextTranslationFrom", lang);
    await ctx.editMessageText(text, { reply_markup: keyboard });
  }
}
