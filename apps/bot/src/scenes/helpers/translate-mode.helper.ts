/**
 * Translate mode helper — handles text translation in persistent translate mode.
 * Called by the mode router when user is in translate mode.
 */
// Context lookup factory — utility function, not a repository (no DI needed)
// Note: createContextLookup is a factory function, not a repository — kept as direct import
import { createContextLookup, languageDetectionRepository, requestTimingRepository } from "@polyglot/adapter-db";
import {
  calculateTranslationCreditCost,
  detectLanguage,
  detectLanguageAsync,
  evaluatePlanRateLimit,
  evaluateRateLimit,
  getDailyWindowReset,
  getDailyWindowStart,
  getLanguageName,
  isSupported,
  logger,
  resolveDirectionFromSource,
  resolveOutputConfig,
  resolveTemplate,
  resolveTranslationDirection,
  type SubscriptionPlan,
  type SupportedLang,
  type TranslateOutput,
  t,
  translateOneWithContext,
  translateWithContext,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { translationCounter, translationDuration } from "../../metrics.js";
import {
  buildPostSaveKeyboard,
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { classifyInput } from "../../utils/classify-input.js";
import { cleanupTechnicalMessages, trackTechnicalMessage } from "../../utils/message-cleanup.js";
import { parseTranslateInput } from "../../utils/parse-translate-input.js";
import { validateTranslatableText } from "../../utils/validate-text-input.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";

/** Singleton lookup function — created once and reused. */
const lookupContext = createContextLookup();

function normalizeLearningLangs(nativeLang: string, learningLangs: readonly string[]): string[] {
  return learningLangs.filter((code, index) => code !== nativeLang && learningLangs.indexOf(code) === index);
}

async function ensureTranslationQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
): Promise<number | null> {
  const creditCost = calculateTranslationCreditCost();
  const windowStart = getDailyWindowStart();
  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(ctx.user.id, windowStart);
  const planLimit = (await ctx.services.settings?.getPlanLimit(plan)) ?? null;
  const requestedCredits = planLimit?.creditCost ?? creditCost;
  const status = planLimit
    ? evaluatePlanRateLimit(
        { plan: planLimit.name, label: planLimit.label, creditsPerDay: planLimit.creditsPerDay },
        usedCredits,
        requestedCredits,
        getDailyWindowReset(),
      )
    : evaluateRateLimit(plan, usedCredits, creditCost, getDailyWindowReset());

  if (!status.allowed) {
    await ctx.reply(t("rateLimitExceeded", lang));
    return null;
  }

  return requestedCredits;
}

/**
 * Handles a text message in translate mode.
 * Translates the text and shows the result with Save/Skip buttons.
 */
export async function handleTranslateText(ctx: BotContext, word: string): Promise<void> {
  const totalStart = Date.now();
  const telegramId = ctx.from!.id;

  // Get user settings
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);
  const subscriptionPlan = ctx.user.subscriptionPlan ?? "free";
  const parsed = parseTranslateInput(word, ctx.message?.entities);
  const cleanWord = parsed.text;
  const contextHint = parsed.contextHint;

  if (cleanWord.length === 0) {
    await ctx.reply(t("contextMarkerNeedsText", lang));
    return;
  }

  // Clean up previous technical messages before starting a new translation
  await cleanupTechnicalMessages(ctx);

  const textValidation = validateTranslatableText(cleanWord);
  if (!textValidation.valid) {
    const reason = textValidation.reason ?? "empty";
    const keyByReason = {
      empty: "inputRejectedEmpty",
      emoji: "emojiNotSupported",
      command: "inputRejectedCommand",
      digits: "inputRejectedDigits",
      tooLong: "inputRejectedTooLong",
    } as const;
    await ctx.reply(t(keyByReason[reason], lang, { max: "500" }));
    return;
  }

  if (learningLangs.length === 0) {
    await ctx.reply(t("translationUnavailable", lang));
    return;
  }

  // Clear reminder flag (Task 58 — source lang menu removed; flag kept for compat).
  if (ctx.session.needsTranslateReminder) {
    ctx.session.needsTranslateReminder = false;
  }

  // Language detection: always detect for each word (don't rely on previous selection)
  const allCandidates = [nativeLang, ...learningLangs];
  // Add "en" as hidden candidate so AI can detect English words
  // (English is the de facto lingua franca for language learning).
  const candidatesWithEnglish = ["en", ...allCandidates];

  // Try fast sync detection first (script + diacritics + franc)
  let preDetectLang: string | undefined = detectLanguage(cleanWord, allCandidates);

  // If sync detection fails, try async detection with AI (last resort)
  if (preDetectLang === undefined) {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
    const aiGenerate = async (prompt: string) => {
      const result = await ctx.services.ai.generateText(prompt, model);
      return result.trim();
    };

    preDetectLang = await detectLanguageAsync(cleanWord, candidatesWithEnglish, {
      contextLookup: lookupContext,
      aiGenerate,
    });
  }

  let sourceLang: string;
  let targetLangs: string[];
  let detectedLang: string | undefined;

  if (preDetectLang === undefined) {
    // Cannot detect language — likely mistype. Store pending state and show warning.
    ctx.session.pendingDetectedLang = undefined;
    ctx.session.pendingWord = cleanWord;
    ctx.session.pendingContextHint = contextHint;

    // Resolve fallback direction for pending state (standard direction)
    const fallbackDir = resolveTranslationDirection({
      text: cleanWord,
      nativeLang,
      learningLangs,
    });
    ctx.session.pendingDirection = {
      sourceLang: fallbackDir.sourceLang,
      targetLangs: fallbackDir.targetLangs,
    };

    languageDetectionRepository
      .record({
        userId: ctx.user.id,
        eventType: "warning_shown",
        word: cleanWord,
        sourceLang: fallbackDir.sourceLang,
        targetLangs: fallbackDir.targetLangs,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to record language detection event");
      });

    const warningText = t("mistypeWarning", lang, {
      word: cleanWord.length > 50 ? `${cleanWord.slice(0, 47)}...` : cleanWord,
    });
    const keyboard = new InlineKeyboard()
      .text(t("mistypeConfirm", lang), "tr:mistype:confirm")
      .text(t("mistypeCancel", lang), "tr:mistype:cancel");

    await ctx.reply(warningText, { reply_markup: keyboard });
    return;
  }

  // Language detected — use detected lang as source
  const direction = resolveDirectionFromSource({
    sourceLang: preDetectLang,
    nativeLang,
    learningLangs,
  });

  if (direction) {
    sourceLang = direction.sourceLang;
    targetLangs = direction.targetLangs;
    detectedLang = preDetectLang;
  } else if (preDetectLang === "en") {
    // AI detected English (lingua franca) but "en" is not in user config.
    // Treat as source language → translate to learning languages.
    sourceLang = "en";
    targetLangs = learningLangs;
    detectedLang = "en";
  } else {
    // Detected lang is no longer in config — use fallback
    const fallback = resolveTranslationDirection({
      text: cleanWord,
      nativeLang,
      learningLangs,
    });
    sourceLang = fallback.sourceLang;
    targetLangs = fallback.targetLangs;
    detectedLang = fallback.detectedLang;
  }

  const classification = classifyInput(cleanWord);
  const isSentence = classification.type === "sentence";
  let preflightMs = 0;
  let dbLookupMs = 0;
  const preflightStart = Date.now();
  const creditCost = await ensureTranslationQuota(ctx, subscriptionPlan, lang);
  if (creditCost === null) {
    return;
  }
  preflightMs = Date.now() - preflightStart;

  logger.debug(
    {
      word: cleanWord,
      contextHint,
      detectedLang,
      sourceLang,
      targetLangs,
      inputType: classification.type,
      wordCount: classification.wordCount,
    },
    "Resolved translation direction",
  );

  // Show loading message
  const loadingMsg = await ctx.reply(t("translating", lang));

  let model: string | undefined;
  try {
    model = await resolveDefaultAIModel(ctx.services?.settings, subscriptionPlan);

    // Load user's template for template-aware output resolution (Task 32)
    const dbLookupStart = Date.now();
    const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, classification.type, cleanWord.length);
    const effectiveTemplate = resolveTemplate(userTpl);
    dbLookupMs = Date.now() - dbLookupStart;

    // For sentences, skip dictionary context lookup (no learnable word to enrich)
    const lookupContextFn = isSentence ? async () => undefined : lookupContext;

    const stopTimer = translationDuration.startTimer();
    const aiStart = Date.now();
    const output = await translateWithContext(
      {
        word: cleanWord,
        sourceLang,
        targetLangs,
        nativeLang,
        model,
        topic: contextHint,
        userId: ctx.user.id,
        outputConfig,
        inputType: classification.type,
      },
      {
        lookupContext: lookupContextFn,
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );
    const aiRequestMs = Date.now() - aiStart;
    stopTimer();
    translationCounter.inc({ status: "success" });
    await ctx.services.translationRequestRepository.logTranslationRequest(
      ctx.user.id,
      cleanWord,
      sourceLang,
      targetLangs,
      creditCost,
    );

    const totalMs = Date.now() - totalStart;
    requestTimingRepository
      .record({
        userId: ctx.user.id,
        requestType: "translate",
        preflightMs,
        dbLookupMs,
        aiRequestMs,
        totalMs,
        modelId: model,
        sourceLang,
        targetLangs,
        inputType: classification.type,
        success: true,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to record request timing");
      });

    // Delete loading message
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    const langCodes = Object.keys(output.translations);

    const sourceLangEntry = ctx.services.languageCache.getLang(output.sourceLang);
    const existing =
      sourceLangEntry && !isSentence
        ? await ctx.services.vocabularyRepository.findByOriginalAndSource(
            ctx.user.id,
            output.original,
            sourceLangEntry.id,
          )
        : null;
    const isAlreadySaved = existing
      ? await ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(ctx.user.id, existing.id)
      : false;

    if (isSentence) {
      // Sentence: compact card with Save/Skip/Regen keyboard
      ctx.session.pendingTranslation = output;

      let card = `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang, nativeLang)}`;

      // Show detected language when it differs from native
      if (detectedLang && detectedLang !== nativeLang) {
        const displayName = getLanguageName(detectedLang, lang);
        card = `${t("detectedLang", lang, { lang: displayName })}\n${card}`;
      }

      const sentMsg = await ctx.reply(card, { parse_mode: "HTML" });
      const keyboard = buildTranslationKeyboard(
        langCodes,
        classification.type,
        lang,
        sentMsg.message_id,
        isAlreadySaved,
      );
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, sentMsg.message_id, { reply_markup: keyboard });

      ctx.session.pendingCardMsgId = sentMsg.message_id;

      ctx.session.translationMap = ctx.session.translationMap ?? {};
      ctx.session.translationMap[String(sentMsg.message_id)] = {
        output,
        inputType: classification.type,
        contextHint,
      };
    } else {
      // Word/phrase: full card with Save/Skip/Regen keyboard
      ctx.session.pendingTranslation = output;

      let card = renderTranslation(output, lang, effectiveTemplate.fields, nativeLang);

      if (detectedLang && detectedLang !== nativeLang) {
        const displayName = getLanguageName(detectedLang, lang);
        card = `${t("detectedLang", lang, { lang: displayName })}\n${card}`;
      }

      const cardMsg = await ctx.reply(card, { parse_mode: "HTML" });

      const keyboard = buildTranslationKeyboard(
        langCodes,
        classification.type,
        lang,
        cardMsg.message_id,
        isAlreadySaved,
      );
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, cardMsg.message_id, { reply_markup: keyboard });

      ctx.session.pendingCardMsgId = cardMsg.message_id;

      ctx.session.translationMap = ctx.session.translationMap ?? {};
      ctx.session.translationMap[String(cardMsg.message_id)] = {
        output,
        inputType: classification.type,
        contextHint,
      };
    }
  } catch (err) {
    translationCounter.inc({ status: "error" });
    logger.error({ err, word: cleanWord, telegramId }, "Translation failed");

    const totalMs = Date.now() - totalStart;
    requestTimingRepository
      .record({
        userId: ctx.user.id,
        requestType: "translate",
        preflightMs,
        dbLookupMs,
        aiRequestMs: 0,
        totalMs,
        modelId: model,
        sourceLang,
        targetLangs,
        inputType: classification.type,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      .catch((timingErr: unknown) => {
        logger.warn({ err: timingErr }, "Failed to record request timing on error");
      });

    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(t("translationError", lang));
  }
}

/**
 * Handles Save callback in translate mode — full FEAT-30 flow.
 * FK resolution → duplicate detection → sanitize → persist → edit card.
 */
export async function handleSaveCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    logger.warn({ userId: ctx.from?.id, msgId }, "Save clicked but translation entry not found (session lost?)");
    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired. Please translate the word again.",
      show_alert: true,
    });
    return;
  }

  const output = entry.output;
  const inputType = entry.inputType;

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  // Step 2 — FK resolution
  const sourceLangEntry = ctx.services.languageCache.getLang(output.sourceLang);
  if (!sourceLangEntry) {
    logger.error({ sourceLang: output.sourceLang }, "Source language not found in cache");
    await ctx.answerCallbackQuery({ text: t("translationError", lang) });
    return;
  }
  const sourceLangId = sourceLangEntry.id;

  // Step 3 — Duplicate detection
  const existing = await ctx.services.vocabularyRepository.findByOriginalAndSource(
    ctx.user.id,
    output.original,
    sourceLangId,
  );
  if (existing) {
    const belongsToDefault = await ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(
      ctx.user.id,
      existing.id,
    );
    if (belongsToDefault) {
      await ctx.answerCallbackQuery({
        text: t("alreadySaved", lang),
        show_alert: true,
      });
      return;
    }

    await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(ctx.user.id, existing.id);
    entry.savedWordId = existing.id;
    await renderSavedTranslationCard(ctx, output, lang, nativeLang, msgId);
    await ctx.answerCallbackQuery();
    return;
  }

  // Step 4 — Map to normalized vocabulary input
  const vocabInput = toVocabularyInput(
    output,
    sourceLangId,
    (inputType as "word" | "phrase" | "sentence") ?? "word",
    (code) => ctx.services.languageCache.getLang(code)?.id ?? null,
  );

  // Step 5 — Persist
  const newEntry = await ctx.services.vocabularyRepository.create(ctx.user.id, vocabInput);
  await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(ctx.user.id, newEntry.id);

  // Step 6 — Update this entry in the map
  entry.savedWordId = newEntry.id;

  await renderSavedTranslationCard(ctx, output, lang, nativeLang, msgId);
  await ctx.answerCallbackQuery();
}

async function renderSavedTranslationCard(
  ctx: BotContext,
  output: TranslateOutput,
  lang: SupportedLang,
  nativeLang: string,
  msgId: number,
): Promise<void> {
  const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  const langCodes = Object.keys(output.translations);
  const savedCard = `${renderTranslation(output, lang, effectiveTemplate.fields, nativeLang)}\n\n${t("savedToDict", lang)}`;
  const keyboard = buildPostSaveKeyboard(langCodes, lang, msgId);
  try {
    await ctx.editMessageText(savedCard, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ err }, "Failed to edit message after save — save still succeeded");
  }
}

/**
 * Handles Skip callback in translate mode.
 */
export async function handleSkipCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired. Please translate the word again.",
      show_alert: true,
    });
    return;
  }

  const output = entry.output;

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  // Remove keyboard, keep the card (template-aware rendering)
  const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  await ctx.editMessageText(renderTranslation(output, lang, effectiveTemplate.fields, nativeLang), {
    parse_mode: "HTML",
  });

  await ctx.answerCallbackQuery();
}

/**
 * Handles regeneration callback in persistent translate mode (tr:regen:{code}:{msgId}).
 * Reads the translation entry from session map by msgId to regenerate
 * the correct language for the specific message the user clicked on.
 * When savedWordId is set, auto-updates the stored DB entry after regen.
 */
export async function handleRegenCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  const parts = data.split(":");
  const regenLang = parts[2] ?? "";
  const msgId = parseInt(parts[3] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await ctx.answerCallbackQuery();
    return;
  }

  const lastOutput = entry.output;
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const isSentence = entry.inputType === "sentence";
  const inputType = entry.inputType;

  // Show regenerating indicator
  await ctx.answerCallbackQuery({
    text: t("regenerating", lang, { lang: regenLang.toUpperCase() }),
  });

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);

    const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
    const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
    const outputConfig = resolveOutputConfig(
      userTpl,
      isSentence ? "sentence" : (inputType ?? "word"),
      lastOutput.original.length,
    );
    const effectiveTemplate = resolveTemplate(userTpl);

    const lookupContextFn = isSentence ? async () => undefined : lookupContext;

    const newTranslation = await translateOneWithContext(
      {
        word: lastOutput.original,
        sourceLang: lastOutput.sourceLang,
        targetLangs: [regenLang],
        targetLang: regenLang,
        nativeLang,
        model,
        topic: entry.contextHint,
        userId: ctx.user.id,
        outputConfig,
        inputType,
      },
      {
        lookupContext: lookupContextFn,
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );

    const updated: typeof lastOutput = {
      ...lastOutput,
      translations: { ...lastOutput.translations, [regenLang]: newTranslation },
    };
    entry.output = updated;

    if (entry.savedWordId) {
      try {
        const targetLangEntry = ctx.services.languageCache.getLang(regenLang);
        if (targetLangEntry) {
          await ctx.services.vocabularyRepository.updateTranslation(entry.savedWordId, targetLangEntry.id, {
            text: newTranslation.text,
            expressionType: newTranslation.expressionType ?? undefined,
            equivalentNote: newTranslation.equivalentNote ?? undefined,
            connotationWarning: newTranslation.connotationWarning ?? undefined,
            details: {
              synonyms: newTranslation.synonyms ?? [],
              examples: newTranslation.examples ?? [],
              alternatives: newTranslation.alternatives ?? undefined,
            },
          });
        }
      } catch (err) {
        logger.error({ err, savedWordId: entry.savedWordId }, "Failed to update saved word after regen");
      }
    }

    const langCodes = Object.keys(updated.translations);

    if (entry.savedWordId) {
      const card = isSentence
        ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(updated, lang, nativeLang)}\n\n${t("savedToDict", lang)}`
        : `${renderTranslation(updated, lang, effectiveTemplate.fields, nativeLang)}\n\n${t("savedToDict", lang)}`;
      const keyboard = buildPostSaveKeyboard(langCodes, lang, msgId);
      await ctx.editMessageText(card, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    } else if (isSentence) {
      const card = `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(updated, lang, nativeLang)}`;
      const keyboard = buildTranslationKeyboard(langCodes, inputType ?? "word", lang, msgId);
      await ctx.editMessageText(card, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    } else {
      const sourceLangEntry = ctx.services.languageCache.getLang(updated.sourceLang);
      const existing = sourceLangEntry
        ? await ctx.services.vocabularyRepository.findByOriginalAndSource(
            ctx.user.id,
            updated.original,
            sourceLangEntry.id,
          )
        : null;
      const isAlreadySaved = existing
        ? await ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(ctx.user.id, existing.id)
        : false;

      const card = renderTranslation(updated, lang, effectiveTemplate.fields, nativeLang);
      const keyboard = buildTranslationKeyboard(langCodes, inputType ?? "word", lang, msgId, isAlreadySaved);
      await ctx.editMessageText(card, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    }
  } catch (err) {
    logger.error({ err, word: lastOutput.original, regenLang }, "Regeneration failed");
  }
}

/**
 * Handles mistype confirmation callback (tr:mistype:confirm).
 * Runs translation using the pending direction stored in session.
 * Clears pending state after completion.
 */
export async function handleMistypeConfirmCallback(ctx: BotContext): Promise<void> {
  const pendingWord = ctx.session.pendingWord;
  const pendingContextHint = ctx.session.pendingContextHint;
  const pendingDirection = ctx.session.pendingDirection;

  if (!pendingWord || !pendingDirection) {
    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired. Please translate the word again.",
      show_alert: true,
    });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const { sourceLang, targetLangs } = pendingDirection;
  const subscriptionPlan = ctx.user.subscriptionPlan ?? "free";

  // Clear pending state immediately
  ctx.session.pendingDetectedLang = undefined;
  ctx.session.pendingWord = undefined;
  ctx.session.pendingContextHint = undefined;
  ctx.session.pendingDirection = undefined;

  languageDetectionRepository
    .record({
      userId: ctx.user.id,
      eventType: "confirmed",
      word: pendingWord,
      sourceLang,
      targetLangs,
    })
    .catch((err: unknown) => {
      logger.warn({ err }, "Failed to record language detection event");
    });

  // Classify input type
  const classification = classifyInput(pendingWord);
  const isSentence = classification.type === "sentence";
  const creditCost = await ensureTranslationQuota(ctx, subscriptionPlan, lang);
  if (creditCost === null) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Show loading message
  const loadingMsg = await ctx.reply(t("translating", lang));

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, subscriptionPlan);

    // Load user's template
    const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, classification.type, pendingWord.length);
    const effectiveTemplate = resolveTemplate(userTpl);

    const lookupContextFn = isSentence ? async () => undefined : lookupContext;

    const stopTimer = translationDuration.startTimer();
    const output = await translateWithContext(
      {
        word: pendingWord,
        sourceLang,
        targetLangs,
        nativeLang,
        model,
        topic: pendingContextHint,
        userId: ctx.user.id,
        outputConfig,
        inputType: classification.type,
      },
      {
        lookupContext: lookupContextFn,
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );
    stopTimer();
    translationCounter.inc({ status: "success" });
    await ctx.services.translationRequestRepository.logTranslationRequest(
      ctx.user.id,
      pendingWord,
      sourceLang,
      targetLangs,
      creditCost,
    );

    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    const langCodes = Object.keys(output.translations);

    const sourceLangEntry = ctx.services.languageCache.getLang(output.sourceLang);
    const existing =
      sourceLangEntry && !isSentence
        ? await ctx.services.vocabularyRepository.findByOriginalAndSource(
            ctx.user.id,
            output.original,
            sourceLangEntry.id,
          )
        : null;
    const isAlreadySaved = existing
      ? await ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(ctx.user.id, existing.id)
      : false;

    if (isSentence) {
      ctx.session.pendingTranslation = output;

      const card = `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang, nativeLang)}`;
      const sentMsg = await ctx.reply(card, { parse_mode: "HTML" });
      const keyboard = buildTranslationKeyboard(
        langCodes,
        classification.type,
        lang,
        sentMsg.message_id,
        isAlreadySaved,
      );
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, sentMsg.message_id, { reply_markup: keyboard });

      ctx.session.pendingCardMsgId = sentMsg.message_id;

      ctx.session.translationMap = ctx.session.translationMap ?? {};
      ctx.session.translationMap[String(sentMsg.message_id)] = {
        output,
        inputType: classification.type,
        contextHint: pendingContextHint,
      };
    } else {
      ctx.session.pendingTranslation = output;

      const card = renderTranslation(output, lang, effectiveTemplate.fields, nativeLang);
      const cardMsg = await ctx.reply(card, { parse_mode: "HTML" });

      const keyboard = buildTranslationKeyboard(
        langCodes,
        classification.type,
        lang,
        cardMsg.message_id,
        isAlreadySaved,
      );
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, cardMsg.message_id, { reply_markup: keyboard });

      ctx.session.pendingCardMsgId = cardMsg.message_id;

      ctx.session.translationMap = ctx.session.translationMap ?? {};
      ctx.session.translationMap[String(cardMsg.message_id)] = {
        output,
        inputType: classification.type,
        contextHint: pendingContextHint,
      };
    }
  } catch (err) {
    translationCounter.inc({ status: "error" });
    logger.error({ err, word: pendingWord }, "Translation failed after mistype confirm");
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(t("translationError", lang));
  }

  await ctx.answerCallbackQuery();
}

/**
 * Handles mistype cancellation callback (tr:mistype:cancel).
 * Clears the pending state and waits for new input.
 */
export async function handleMistypeCancelCallback(ctx: BotContext): Promise<void> {
  const pendingWord = ctx.session.pendingWord;

  ctx.session.pendingDetectedLang = undefined;
  ctx.session.pendingWord = undefined;
  ctx.session.pendingContextHint = undefined;
  ctx.session.pendingDirection = undefined;

  if (pendingWord) {
    languageDetectionRepository
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
}
