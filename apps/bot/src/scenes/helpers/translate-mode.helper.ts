/**
 * Translate mode helper — handles text translation in persistent translate mode.
 * Called by the mode router when user is in translate mode.
 */
// Context lookup factory — utility function, not a repository (no DI needed)
// Note: createContextLookup is a factory function, not a repository — kept as direct import
import { createContextLookup, languageDetectionRepository, requestTimingRepository } from "@polyglot/adapter-db";
import {
  calculateTranslationCreditCost,
  type DetectionResult,
  defaultFeatureAccess,
  detectLanguageWithConfidence,
  detectLanguageWithConfidenceAsync,
  evaluatePlanRateLimit,
  evaluateRateLimit,
  generateGrammarBreakdown,
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
  type TranslationAmbiguity,
  t,
  translateWithContext,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { translationCounter, translationDuration } from "../../metrics.js";
import {
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

function getUserLanguageGroup(nativeLang: string, learningLangs: readonly string[]): string[] {
  return [nativeLang, ...learningLangs].filter((code, index, all) => all.indexOf(code) === index);
}

function clearPendingClarification(ctx: BotContext): void {
  ctx.session.pendingClarification = undefined;
  ctx.session.awaitingTranslationClarificationContext = undefined;
}

function resolveTargetsForClarifiedSource(
  selectedSource: string,
  nativeLang: string,
  learningLangs: readonly string[],
  fallbackTargetLangs: readonly string[],
): string[] {
  const userLangs = getUserLanguageGroup(nativeLang, learningLangs);
  const targets = userLangs.filter((code) => code !== selectedSource);
  return targets.length > 0 ? targets : [...fallbackTargetLangs];
}

function hasActionableLanguageAmbiguity(detection: DetectionResult): boolean {
  const candidates = detection.ambiguousCandidates ?? [];
  if (candidates.length < 2) {
    return false;
  }

  const wiktionaryCandidates = new Set(
    detection.evidence.filter((entry) => entry.strategy === "wiktionary").map((entry) => entry.candidate),
  );
  return candidates.filter((candidate) => wiktionaryCandidates.has(candidate)).length >= 2;
}

function clarificationReasonText(ambiguity: TranslationAmbiguity, lang: SupportedLang): string {
  const fallbackByReason: Record<TranslationAmbiguity["reason"], string> = {
    source_language: t("translationClarifyReasonLanguage", lang),
    word_sense: t("translationClarifyReasonMeaning", lang),
    possible_typo: t("translationClarifyReasonMeaning", lang),
    date_or_time: t("translationClarifyReasonFormat", lang),
    placeholder_grammar: t("translationClarifyReasonFormat", lang),
    mixed_or_transliterated_input: t("translationClarifyReasonFormat", lang),
    unsupported_input: t("translationClarifyReasonFormat", lang),
  };
  const technicalPattern = /\b(sourceLang|targetLangs|JSON|schema|pipeline|validation|fieldPath)\b/i;
  if (ambiguity.message.trim() && !technicalPattern.test(ambiguity.message)) {
    return ambiguity.message.trim();
  }
  return fallbackByReason[ambiguity.reason];
}

async function showTranslationClarification(
  ctx: BotContext,
  params: {
    word: string;
    contextHint?: string;
    sourceLang: string;
    targetLangs: string[];
    detectionConfidence?: number;
    nativeLang: string;
    learningLangs: string[];
    inputType: "word" | "phrase" | "sentence";
    ambiguity: TranslationAmbiguity;
    lang: SupportedLang;
  },
): Promise<void> {
  ctx.session.pendingClarification = {
    word: params.word,
    contextHint: params.contextHint,
    sourceLang: params.sourceLang,
    targetLangs: params.targetLangs,
    inputType: params.inputType,
    reason: params.ambiguity.reason,
    options: params.ambiguity.options,
  };
  ctx.session.awaitingTranslationClarificationContext = undefined;

  const keyboard = new InlineKeyboard();
  const options = params.ambiguity.options ?? [];
  const hasSourceLanguageOptions = options.some((option) => option.kind === "source_language");
  options.forEach((option, index) => {
    keyboard.text(option.label, `tr:clarify:option:${index}`).row();
  });

  if (params.ambiguity.reason === "source_language" && !hasSourceLanguageOptions) {
    for (const code of getUserLanguageGroup(params.nativeLang, params.learningLangs)) {
      keyboard.text(getLanguageName(code, params.lang), `tr:clarify:lang:${code}`).row();
    }
  }
  keyboard.text(t("translationClarifyContextButton", params.lang), "tr:clarify:context").row();

  await ctx.reply(
    t("translationClarifyPrompt", params.lang, {
      reason: clarificationReasonText(params.ambiguity, params.lang),
    }),
    { reply_markup: keyboard },
  );
}

async function runClarifiedTranslation(
  ctx: BotContext,
  pending: NonNullable<BotContext["session"]["pendingClarification"]>,
  sourceLang: string,
  targetLangs: string[],
  contextHint?: string,
  wordOverride?: string,
): Promise<void> {
  clearPendingClarification(ctx);
  ctx.session.pendingDetectedLang = undefined;
  ctx.session.pendingWord = wordOverride ?? pending.word;
  ctx.session.pendingContextHint = contextHint;
  ctx.session.pendingDirection = { sourceLang, targetLangs };
  await handleMistypeConfirmCallback(ctx);
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
  const candidatesWithEnglish = ["en", ...allCandidates];

  // Confidence-aware detection: sync first (script + diacritics + franc)
  let detection: DetectionResult = detectLanguageWithConfidence(cleanWord, allCandidates);

  // If sync detection is ambiguous, try async with Wiktionary + AI
  if (detection.language === undefined) {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
    const aiGenerate = async (prompt: string) => {
      const result = await ctx.services.ai.generateText(prompt, model);
      return result.trim();
    };

    detection = await detectLanguageWithConfidenceAsync(cleanWord, candidatesWithEnglish, {
      contextLookup: lookupContext,
      aiGenerate,
    });
  }

  logger.debug(
    {
      word: cleanWord,
      detectedLang: detection.language,
      confidence: detection.confidence,
      ambiguousCandidates: detection.ambiguousCandidates,
      evidenceCount: detection.evidence.length,
    },
    "Language detection result",
  );

  let sourceLang: string;
  let targetLangs: string[];
  let detectedLang: string | undefined;

  if (detection.language !== undefined) {
    // Language detected with confidence — use it as source
    const direction = resolveDirectionFromSource({
      sourceLang: detection.language,
      nativeLang,
      learningLangs,
    });

    if (direction) {
      sourceLang = direction.sourceLang;
      targetLangs = direction.targetLangs;
      detectedLang = detection.language;
    } else if (detection.language === "en") {
      sourceLang = "en";
      targetLangs = learningLangs;
      detectedLang = "en";
    } else {
      const fallback = resolveTranslationDirection({
        text: cleanWord,
        nativeLang,
        learningLangs,
      });
      sourceLang = fallback.sourceLang;
      targetLangs = fallback.targetLangs;
      detectedLang = fallback.detectedLang;
    }
  } else if (hasActionableLanguageAmbiguity(detection)) {
    // Real language ambiguity with dictionary evidence in multiple languages — ask user to select.
    ctx.session.pendingDetectedLang = undefined;
    ctx.session.pendingWord = cleanWord;
    ctx.session.pendingContextHint = contextHint;

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

    const promptText = t("langSelectPrompt", lang, {
      word: cleanWord.length > 50 ? `${cleanWord.slice(0, 47)}...` : cleanWord,
    });
    const keyboard = new InlineKeyboard();
    const ambiguousCandidates = detection.ambiguousCandidates ?? [];
    for (const candidate of ambiguousCandidates) {
      const langName = getLanguageName(candidate, lang);
      keyboard.text(langName, `tr:langselect:${candidate}`).row();
    }
    keyboard.text(t("mistypeCancel", lang), "tr:langselect:cancel");

    await ctx.reply(promptText, { reply_markup: keyboard });
    return;
  } else if (detection.ambiguousCandidates && detection.ambiguousCandidates.length > 0) {
    // Weak ambiguity such as shared Latin script is not enough to interrupt the user.
    const fallback = resolveTranslationDirection({
      text: cleanWord,
      nativeLang,
      learningLangs,
    });
    sourceLang = fallback.sourceLang;
    targetLangs = fallback.targetLangs;
    detectedLang = fallback.detectedLang;
  } else {
    // Truly inconclusive — no candidates scored above zero. Show mistype warning.
    ctx.session.pendingDetectedLang = undefined;
    ctx.session.pendingWord = cleanWord;
    ctx.session.pendingContextHint = contextHint;

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
    const lookupContextFn = isSentence ? async () => [] : lookupContext;

    const stopTimer = translationDuration.startTimer();
    const aiStart = Date.now();
    const decision = await translateWithContext(
      {
        word: cleanWord,
        sourceLang,
        targetLangs,
        nativeLang,
        model,
        topic: contextHint,
        userId: ctx.user.id,
        interfaceLang: lang,
        detectionConfidence: detection.confidence,
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

    if (decision.status === "needs_clarification") {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
      await showTranslationClarification(ctx, {
        word: cleanWord,
        contextHint,
        sourceLang,
        targetLangs,
        nativeLang,
        learningLangs,
        detectionConfidence: detection.confidence,
        inputType: classification.type,
        ambiguity: decision.ambiguity,
        lang,
      });
      return;
    }

    const output = decision.output;
    const needsReview = decision.status === "needs_review";
    const recordedModelId = decision.status === "accepted" ? decision.quality.modelId : model;
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
        modelId: recordedModelId,
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

    {
      ctx.session.pendingTranslation = output;

      const card = isSentence
        ? (() => {
            let c = `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang, nativeLang, needsReview)}`;
            if (detectedLang && detectedLang !== nativeLang) {
              const displayName = getLanguageName(detectedLang, lang);
              c = `${t("detectedLang", lang, { lang: displayName })}\n${c}`;
            }
            return c;
          })()
        : (() => {
            let c = renderTranslation(output, lang, effectiveTemplate.fields, nativeLang, needsReview);
            if (detectedLang && detectedLang !== nativeLang) {
              const displayName = getLanguageName(detectedLang, lang);
              c = `${t("detectedLang", lang, { lang: displayName })}\n${c}`;
            }
            return c;
          })();

      const cardMsg = await ctx.reply(card, { parse_mode: "HTML" });
      const showGrammarButton =
        classification.type !== "word" &&
        (classification.type === "sentence" || !effectiveTemplate.fields.grammarBreakdown);
      const keyboard = buildTranslationKeyboard(lang, cardMsg.message_id, isAlreadySaved, showGrammarButton);
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
    await showSavedCard(ctx, output, lang, nativeLang, inputType);
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

  await showSavedCard(ctx, output, lang, nativeLang, inputType);
  await ctx.answerCallbackQuery();
}

async function showSavedCard(
  ctx: BotContext,
  output: TranslateOutput,
  lang: SupportedLang,
  nativeLang: string,
  inputType?: string,
): Promise<void> {
  const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  const isSentence = inputType === "sentence";
  const cardText = isSentence
    ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang, nativeLang)}`
    : renderTranslation(output, lang, effectiveTemplate.fields, nativeLang);
  const savedCard = `${cardText}\n\n${t("savedToDict", lang)}`;
  try {
    await ctx.editMessageText(savedCard, {
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ err }, "Failed to edit message after save — save still succeeded");
  }
}

/** @deprecated Kept for old messages with skip buttons. */
export async function handleSkipCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}

/** @deprecated Kept for old messages with per-language regen buttons. */
export async function handleRegenCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}

/**
 * Handles "Clarify" callback (tr:clarifypost:{msgId}).
 * Prompts user to enter context, then retranslates with that context.
 */
export async function handleClarifyPostCallback(ctx: BotContext): Promise<void> {
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

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  ctx.session.awaitingTranslationClarificationContext = true;
  ctx.session.pendingPostTranslationClarifyMsgId = msgId;

  await ctx.reply(t("clarifyTranslationPrompt", lang));
  await ctx.answerCallbackQuery();
}

/**
 * Handles "Other meaning" callback (tr:altmeaning:{msgId}).
 * Retranslates all languages with negative constraints to avoid repeating previous translations.
 */
export async function handleAltMeaningCallback(ctx: BotContext): Promise<void> {
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

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  // Accumulate negative constraints
  const prev = entry.previousTranslations ?? {};
  for (const [langCode, translation] of Object.entries(entry.output.translations)) {
    prev[langCode] = prev[langCode] ?? [];
    prev[langCode].push(translation.text);
  }
  entry.previousTranslations = prev;

  await ctx.answerCallbackQuery({ text: t("regeneratingAll", lang) });

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
    const isSentence = entry.inputType === "sentence";
    const targetLangs = Object.keys(entry.output.translations);

    const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
    const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
    const outputConfig = resolveOutputConfig(
      userTpl,
      isSentence ? "sentence" : (entry.inputType ?? "word"),
      entry.output.original.length,
    );
    const effectiveTemplate = resolveTemplate(userTpl);

    const lookupContextFn = isSentence ? async () => [] : lookupContext;

    const decision = await translateWithContext(
      {
        word: entry.output.original,
        sourceLang: entry.output.sourceLang,
        targetLangs,
        nativeLang,
        model,
        topic: entry.contextHint,
        userId: ctx.user.id,
        outputConfig,
        inputType: entry.inputType,
        negativeConstraints: entry.previousTranslations,
      },
      {
        lookupContext: lookupContextFn,
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );

    if (decision.status === "needs_clarification") {
      throw new Error("Unexpected needs_clarification in alt meaning flow");
    }

    entry.output = decision.output;
    entry.grammarBreakdown = undefined;

    const cardText = isSentence
      ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(decision.output, lang, nativeLang)}`
      : renderTranslation(decision.output, lang, effectiveTemplate.fields, nativeLang);

    const showGrammarButton = entry.inputType !== "word" && (isSentence || !effectiveTemplate.fields.grammarBreakdown);
    const keyboard = buildTranslationKeyboard(lang, msgId, undefined, showGrammarButton);
    await ctx.editMessageText(cardText, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  } catch (err) {
    logger.error({ err, word: entry.output.original }, "Alt meaning regeneration failed");
  }
}

/**
 * Handles grammar breakdown callback (tr:grammar:{msgId}).
 * Generates on-demand grammar analysis for translations.
 */
export async function handleGrammarBreakdownCallback(ctx: BotContext): Promise<void> {
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

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  // Check feature access
  const featureAccess = ctx.services.featureAccess ?? defaultFeatureAccess;
  const access = await featureAccess.checkFeatureAccess(ctx.user.id, "grammarBreakdown");
  if (!access.hasAccess) {
    await ctx.answerCallbackQuery({
      text: t("grammarLocked", lang),
      show_alert: true,
    });
    return;
  }

  // Use cached if available
  if (entry.grammarBreakdown) {
    await reRenderCardWithGrammar(ctx, entry, msgId, lang, nativeLang);
    await ctx.answerCallbackQuery();
    return;
  }

  await ctx.answerCallbackQuery();

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
    const translations: Record<string, string> = {};
    for (const [code, tr] of Object.entries(entry.output.translations)) {
      translations[code] = tr.text;
    }

    const result = await generateGrammarBreakdown(
      {
        originalText: entry.output.original,
        translations,
        sourceLang: entry.output.sourceLang,
        targetLangs: Object.keys(entry.output.translations),
        nativeLang,
        inputType: entry.inputType === "sentence" ? "sentence" : "phrase",
      },
      ctx.services.ai.generateObject,
      model,
      ctx.user.id,
    );

    entry.grammarBreakdown = result;
    await reRenderCardWithGrammar(ctx, entry, msgId, lang, nativeLang);
  } catch (err) {
    logger.error({ err, word: entry.output.original }, "Grammar breakdown generation failed");
  }
}

async function reRenderCardWithGrammar(
  ctx: BotContext,
  entry: NonNullable<BotContext["session"]["translationMap"]>[string],
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<void> {
  const isSentence = entry.inputType === "sentence";
  const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  const cardText = isSentence
    ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(entry.output, lang, nativeLang, false, entry.grammarBreakdown)}`
    : renderTranslation(entry.output, lang, effectiveTemplate.fields, nativeLang, false, entry.grammarBreakdown);

  // Remove grammar button since breakdown is now shown
  const keyboard = buildTranslationKeyboard(lang, msgId);
  await ctx.api.editMessageText(ctx.chat!.id, msgId, cardText, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });
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
  clearPendingClarification(ctx);

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

    const lookupContextFn = isSentence ? async () => [] : lookupContext;

    const stopTimer = translationDuration.startTimer();
    const decision = await translateWithContext(
      {
        word: pendingWord,
        sourceLang,
        targetLangs,
        nativeLang,
        model,
        topic: pendingContextHint,
        userId: ctx.user.id,
        interfaceLang: lang,
        outputConfig,
        inputType: classification.type,
      },
      {
        lookupContext: lookupContextFn,
        generateObjectFn: ctx.services.ai.generateObject,
      },
    );
    stopTimer();

    if (decision.status === "needs_clarification") {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
      await showTranslationClarification(ctx, {
        word: pendingWord,
        contextHint: pendingContextHint,
        sourceLang,
        targetLangs,
        nativeLang,
        learningLangs: normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []),
        inputType: classification.type,
        ambiguity: decision.ambiguity,
        lang,
      });
      await ctx.answerCallbackQuery();
      return;
    }

    const output = decision.output;
    const needsReview = decision.status === "needs_review";
    translationCounter.inc({ status: "success" });
    await ctx.services.translationRequestRepository.logTranslationRequest(
      ctx.user.id,
      pendingWord,
      sourceLang,
      targetLangs,
      creditCost,
    );

    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

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

    {
      ctx.session.pendingTranslation = output;

      const card = isSentence
        ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang, nativeLang, needsReview)}`
        : renderTranslation(output, lang, effectiveTemplate.fields, nativeLang, needsReview);

      const cardMsg = await ctx.reply(card, { parse_mode: "HTML" });
      const showGrammarButton =
        classification.type !== "word" &&
        (classification.type === "sentence" || !effectiveTemplate.fields.grammarBreakdown);
      const keyboard = buildTranslationKeyboard(lang, cardMsg.message_id, isAlreadySaved, showGrammarButton);
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

/**
 * Handles translation clarification callbacks.
 */
export async function handleTranslationClarificationCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const pending = ctx.session.pendingClarification;
  if (!data || !pending) {
    clearPendingClarification(ctx);
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
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);

  if (data === "tr:clarify:cancel") {
    clearPendingClarification(ctx);
    await ctx.answerCallbackQuery();
    const msg = await ctx.reply(t("translateModeHint", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  if (data === "tr:clarify:context") {
    ctx.session.awaitingTranslationClarificationContext = true;
    await ctx.answerCallbackQuery();
    const msg = await ctx.reply(t("translationClarifyContextPrompt", lang));
    trackTechnicalMessage(ctx, msg.message_id);
    return;
  }

  if (data.startsWith("tr:clarify:lang:")) {
    const selectedSource = data.replace("tr:clarify:lang:", "");
    const targetLangs = resolveTargetsForClarifiedSource(
      selectedSource,
      nativeLang,
      learningLangs,
      pending.targetLangs,
    );
    await ctx.answerCallbackQuery();
    await runClarifiedTranslation(ctx, pending, selectedSource, targetLangs, pending.contextHint);
    return;
  }

  if (data.startsWith("tr:clarify:option:")) {
    const index = Number.parseInt(data.replace("tr:clarify:option:", ""), 10);
    const option = pending.options?.[index];
    if (!option) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Session expired. Please translate the word again.",
        show_alert: true,
      });
      return;
    }
    if (option.kind === "source_language" && option.langCode) {
      const targetLangs = resolveTargetsForClarifiedSource(
        option.langCode,
        nativeLang,
        learningLangs,
        pending.targetLangs,
      );
      await ctx.answerCallbackQuery();
      await runClarifiedTranslation(ctx, pending, option.langCode, targetLangs, pending.contextHint);
      return;
    }
    if (option.kind === "typo_correction" && option.correctedText) {
      const sourceLang = option.langCode ?? pending.sourceLang;
      const targetLangs =
        option.langCode !== undefined
          ? resolveTargetsForClarifiedSource(option.langCode, nativeLang, learningLangs, pending.targetLangs)
          : pending.targetLangs;
      await ctx.answerCallbackQuery();
      await runClarifiedTranslation(ctx, pending, sourceLang, targetLangs, pending.contextHint, option.correctedText);
      return;
    }
    if (option.kind === "translate_as_written") {
      await ctx.answerCallbackQuery();
      await runClarifiedTranslation(ctx, pending, pending.sourceLang, pending.targetLangs, pending.contextHint);
      return;
    }
    const contextHint = pending.contextHint
      ? `${pending.contextHint}; ${option.label}: ${option.value}`
      : `${option.label}: ${option.value}`;
    await ctx.answerCallbackQuery();
    await runClarifiedTranslation(ctx, pending, pending.sourceLang, pending.targetLangs, contextHint);
    return;
  }

  await ctx.answerCallbackQuery();
}

/**
 * Captures the next text message as clarification context and retries translation.
 */
export async function handleTranslationClarificationContextText(ctx: BotContext, text: string): Promise<void> {
  // Post-translation clarify flow (from "Уточнить" button on rendered card)
  const postClarifyMsgId = ctx.session.pendingPostTranslationClarifyMsgId;
  if (postClarifyMsgId != null) {
    ctx.session.awaitingTranslationClarificationContext = undefined;
    ctx.session.pendingPostTranslationClarifyMsgId = undefined;

    const entry = ctx.session.translationMap?.[String(postClarifyMsgId)];
    if (!entry) {
      const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
      const iLang = settings?.interfaceLang ?? "en";
      const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
      await ctx.reply(t("translationError", lang));
      return;
    }

    const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
    const nativeLang = settings?.nativeLang ?? "en";

    // Replace context (not accumulate)
    entry.contextHint = text.trim();

    try {
      const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
      const isSentence = entry.inputType === "sentence";
      const targetLangs = Object.keys(entry.output.translations);

      const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
      const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
      const outputConfig = resolveOutputConfig(
        userTpl,
        isSentence ? "sentence" : (entry.inputType ?? "word"),
        entry.output.original.length,
      );
      const effectiveTemplate = resolveTemplate(userTpl);

      const lookupContextFn = isSentence ? async () => [] : lookupContext;

      const decision = await translateWithContext(
        {
          word: entry.output.original,
          sourceLang: entry.output.sourceLang,
          targetLangs,
          nativeLang,
          model,
          topic: entry.contextHint,
          userId: ctx.user.id,
          outputConfig,
          inputType: entry.inputType,
        },
        {
          lookupContext: lookupContextFn,
          generateObjectFn: ctx.services.ai.generateObject,
        },
      );

      if (decision.status === "needs_clarification") {
        throw new Error("Unexpected needs_clarification in post-translation clarify flow");
      }

      entry.output = decision.output;
      entry.grammarBreakdown = undefined;

      const cardText = isSentence
        ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(decision.output, lang, nativeLang)}`
        : renderTranslation(decision.output, lang, effectiveTemplate.fields, nativeLang);

      const showGrammarButton =
        entry.inputType !== "word" && (isSentence || !effectiveTemplate.fields.grammarBreakdown);
      const keyboard = buildTranslationKeyboard(lang, postClarifyMsgId, undefined, showGrammarButton);
      await ctx.api.editMessageText(ctx.chat!.id, postClarifyMsgId, cardText, {
        reply_markup: keyboard,
        parse_mode: "HTML",
      });
    } catch (err) {
      logger.error({ err, word: entry.output.original }, "Post-translation clarify failed");
    }
    return;
  }

  // Pre-translation clarify flow (original ambiguity resolution)
  const pending = ctx.session.pendingClarification;
  if (!pending) {
    clearPendingClarification(ctx);
    const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
    await ctx.reply(t("translationError", lang));
    return;
  }

  const contextHint = pending.contextHint ? `${pending.contextHint}; ${text.trim()}` : text.trim();
  await runClarifiedTranslation(ctx, pending, pending.sourceLang, pending.targetLangs, contextHint);
}
