/**
 * Translate flow (Fable T22/B2 slice (e)) — the main text-translation entry
 * points and the single translation pipeline they share.
 *
 * `handleTranslateText` (a plain text message in translate mode) and
 * `handleMistypeConfirmCallback` (the user confirmed an ambiguous input) both
 * resolve direction/quota and then run `runTranslationPipeline`, so the pipeline
 * is defined once here. `showTranslationClarification` — the "ask the user which
 * meaning/language" prompt the pipeline raises — also lives here (its response
 * handlers live in `clarification.ts`); keeping the prompt on the flow side lets
 * `clarification` depend on this module without a cycle.
 */
import {
  type DetectionResult,
  detectLanguageWithConfidence,
  detectLanguageWithConfidenceAsync,
  detectOutOfSetByAlphabet,
  detectOutOfSetLanguage,
  getLangFlag,
  getLanguageName,
  type InputType,
  isSupported,
  isSupportedLanguage,
  logger,
  needsDictionaryVerification,
  resolveDirectionFromSource,
  resolveOutputConfig,
  resolveTemplate,
  resolveTranslationDirection,
  type SupportedLang,
  type TranslateOutput,
  type TranslationAmbiguity,
  t,
  translateWithContext,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import {
  inputCorrectionCounter,
  translationCounter,
  translationDuration,
  unrecognizedWordCounter,
} from "../../metrics.js";
import {
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { ensureAiQuota } from "../../utils/ai-quota.js";
import { classifyInput } from "../../utils/classify-input.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, sendTypingIndicator, withTimeout } from "../../utils/long-op.js";
import { cleanupTechnicalMessages, trackTechnicalMessage } from "../../utils/message-cleanup.js";
import { parseTranslateInput } from "../../utils/parse-translate-input.js";
import { validateTranslatableText } from "../../utils/validate-text-input.js";
import {
  clearPendingClarification,
  getUserLanguageGroup,
  isEtymologyEligible,
  normalizeLearningLangs,
  showAddLanguagePrompt,
} from "./translate-mode.shared.js";
import { setTranslationEntry } from "./translation-map.helper.js";

/** Check if any LanguageTranslation has grammarBreakdown data */
function hasGrammarBreakdownData(output: TranslateOutput): boolean {
  return Object.values(output.translations).some((tr) => tr.grammarBreakdown && tr.grammarBreakdown.length > 0);
}

/** Collect grammarBreakdown from LanguageTranslation blocks into a flat record */
function collectGrammarBreakdown(output: TranslateOutput): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [code, tr] of Object.entries(output.translations)) {
    if (tr.grammarBreakdown && tr.grammarBreakdown.length > 0) {
      result[code] = tr.grammarBreakdown;
    }
  }
  return result;
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
  // Core returns structured reason + params (Fable T23/A13); the channel
  // localizes here via t(). `params.lang` is a source-language CODE — localize
  // its display name locally.
  const params = ambiguity.params ?? {};
  const fallbackByReason: Record<TranslationAmbiguity["reason"], string> = {
    source_language: t("translationClarifyReasonLanguage", lang),
    word_sense: t("translationClarifyReasonMeaning", lang),
    possible_typo: t("translationClarifyReasonMeaning", lang),
    date_or_time: t("translationClarifyReasonFormat", lang),
    placeholder_grammar: t("translationClarifyReasonFormat", lang),
    mixed_or_transliterated_input: t("translationClarifyReasonFormat", lang),
    unsupported_input: t("translationClarifyReasonFormat", lang),
    unrecognized_word: t("translationClarifyReasonUnrecognized", lang, {
      word: params.word ?? "",
      lang: params.lang ? getLanguageName(params.lang, lang) : "",
    }),
  };
  const technicalPattern = /\b(sourceLang|targetLangs|JSON|schema|pipeline|validation|fieldPath)\b/i;
  const message = ambiguity.message?.trim();
  if (message && !technicalPattern.test(message)) {
    return message;
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

  if (params.ambiguity.reason === "possible_typo") {
    inputCorrectionCounter.inc({ outcome: "confirm_shown", input_type: params.inputType });
  }

  if (params.ambiguity.reason === "unrecognized_word") {
    const hasCorrection = (params.ambiguity.options ?? []).some((o) => o.kind === "typo_correction");
    unrecognizedWordCounter.inc({ outcome: hasCorrection ? "correction_offered" : "rejected" });
  }

  const keyboard = new InlineKeyboard();
  const options = params.ambiguity.options ?? [];
  // Language choices render as flag + code buttons (🇬🇧 EN) in rows of up to 4,
  // built on our side from langCode — the model must not put language names in
  // labels. Everything else (typo corrections, "translate as written", meanings)
  // keeps its model-authored label, one per row.
  const indexed = options.map((option, index) => ({ option, index }));
  const languageOptions = indexed.filter(({ option }) => option.kind === "source_language" && option.langCode);
  const otherOptions = indexed.filter(({ option }) => !(option.kind === "source_language" && option.langCode));

  const addFlagRows = (entries: { label: string; data: string }[]): void => {
    for (let i = 0; i < entries.length; i += 4) {
      for (const entry of entries.slice(i, i + 4)) {
        keyboard.text(entry.label, entry.data);
      }
      keyboard.row();
    }
  };

  addFlagRows(
    languageOptions.map(({ option, index }) => ({
      label: `${getLangFlag(option.langCode as string) ?? "🔤"} ${(option.langCode as string).toUpperCase()}`,
      data: `tr:clarify:option:${index}`,
    })),
  );

  for (const { option, index } of otherOptions) {
    // Core omits the localized label for "translate as written" (Fable T23/A13);
    // the channel supplies it from the option kind. Other options keep their
    // model-authored/data label.
    const label =
      option.kind === "translate_as_written"
        ? t("translationTranslateAsWritten", params.lang)
        : (option.label ?? option.value);
    keyboard.text(label, `tr:clarify:option:${index}`).row();
  }

  // No model-supplied language options but we still need a language choice —
  // offer the user's configured languages as flag + code buttons.
  const showFallbackLanguages = params.ambiguity.reason === "source_language" && languageOptions.length === 0;
  if (showFallbackLanguages) {
    addFlagRows(
      getUserLanguageGroup(params.nativeLang, params.learningLangs).map((code) => ({
        label: `${getLangFlag(code) ?? "🔤"} ${code.toUpperCase()}`,
        data: `tr:clarify:lang:${code}`,
      })),
    );
  }

  keyboard.text(t("translationClarifyContextButton", params.lang), "tr:clarify:context").row();

  const hasLanguageButtons = languageOptions.length > 0 || showFallbackLanguages;
  const promptText = t("translationClarifyPrompt", params.lang, {
    reason: clarificationReasonText(params.ambiguity, params.lang),
  });
  const message = hasLanguageButtons
    ? `${promptText}\n\n${t("translationClarifyLanguageHint", params.lang)}`
    : promptText;

  await ctx.reply(message, { reply_markup: keyboard });
}

/**
 * Handles a text message in translate mode.
 * Translates the text and shows the result with Save/Skip buttons.
 */
export async function handleTranslateText(ctx: BotContext, word: string): Promise<void> {
  const totalStart = Date.now();

  // Instant feedback while the silent pre-phase (settings, quota, language
  // detection) runs — the "translating" loader appears only after it.
  sendTypingIndicator(ctx);

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

  // Escalate to async (dictionary sweep + Wiktionary + AI) when sync is
  // ambiguous, or when a confident single-word result rests on heuristics
  // alone and needs dictionary confirmation (e.g. "Strohá" is not English).
  if (detection.language === undefined || needsDictionaryVerification(cleanWord, detection)) {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
    const aiGenerate = async (prompt: string) => {
      const result = await ctx.services.ai.generateText(prompt, model);
      return result.trim();
    };

    detection = await detectLanguageWithConfidenceAsync(cleanWord, candidatesWithEnglish, {
      contextLookup: ctx.services.contextLookup,
      findWordLanguages: ctx.services.wordLanguageSweep,
      aiGenerate,
    });
  }

  logger.debug(
    {
      word: cleanWord,
      detectedLang: detection.language,
      confidence: detection.confidence,
      ambiguousCandidates: detection.ambiguousCandidates,
      outOfSetLanguages: detection.outOfSetLanguages,
      evidenceCount: detection.evidence.length,
    },
    "Language detection result",
  );

  // Out-of-set guard: input is confidently in a language the user hasn't configured.
  // The closed-set detector would otherwise coerce it to the nearest candidate (e.g. German
  // → English), so tell the user it isn't selected instead of mistranslating.
  // Signal precedence: dictionary sweep / AI (populated on detection) → cheap,
  // word-count-independent alphabet exclusion (letters only one out-of-set
  // language can produce, e.g. ñ→es, ә→kk) → franc-based check for 3+ words.
  const outOfSetLang =
    detection.outOfSetLanguages?.[0] ??
    detectOutOfSetByAlphabet(cleanWord, candidatesWithEnglish) ??
    detectOutOfSetLanguage(cleanWord, candidatesWithEnglish);
  if (outOfSetLang) {
    // Supported but not-studied → offer "add and translate". Unsupported languages
    // can't be added, so fall back to the plain informational block.
    if (isSupportedLanguage(outOfSetLang)) {
      await showAddLanguagePrompt(ctx, lang, outOfSetLang, cleanWord, contextHint);
      return;
    }
    ctx.services.languageDetectionRepository
      .record({
        userId: ctx.user.id,
        eventType: "out_of_set",
        word: cleanWord,
        sourceLang: outOfSetLang,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to record language detection event");
      });
    await ctx.reply(t("languageNotSelected", lang, { lang: getLanguageName(outOfSetLang, lang) }));
    return;
  }

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

    ctx.services.languageDetectionRepository
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

    ctx.services.languageDetectionRepository
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

  // Telemetry: confident detections feed the golden regression set.
  if (detection.language !== undefined) {
    ctx.services.languageDetectionRepository
      .record({
        userId: ctx.user.id,
        eventType: "detected",
        word: cleanWord,
        sourceLang,
        targetLangs,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to record language detection event");
      });
  }

  const classification = classifyInput(cleanWord);
  const isSentence = classification.type === "sentence";
  let preflightMs = 0;
  const preflightStart = Date.now();
  const creditCost = await ensureAiQuota(ctx, subscriptionPlan, lang, "translate");
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

  await runTranslationPipeline(ctx, {
    word: cleanWord,
    sourceLang,
    targetLangs,
    nativeLang,
    lang,
    subscriptionPlan,
    creditCost,
    classification,
    isSentence,
    loadingMsg,
    learningLangs,
    contextHint,
    detectionConfidence: detection.confidence,
    detectedLang,
    withInlineGrammar: true,
    timing: { preflightMs, totalStart },
  });
}

/**
 * Whether the translated headword already exists in the user's default
 * dictionary. Shared by both translation entry points (T22/B2) — identical FK
 * resolution + duplicate lookup that was previously copied per handler.
 */
async function resolveIsAlreadySaved(ctx: BotContext, output: TranslateOutput, isSentence: boolean): Promise<boolean> {
  const sourceLangEntry = ctx.services.languageCache.getLang(output.sourceLang);
  const existing =
    sourceLangEntry && !isSentence
      ? await ctx.services.vocabularyRepository.findByOriginalAndSource(
          ctx.user.id,
          output.original,
          sourceLangEntry.id,
        )
      : null;
  return existing
    ? await ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(ctx.user.id, existing.id)
    : false;
}

/**
 * Renders a completed translation into a card, attaches the inline keyboard, and
 * stores the per-message translation entry. Shared by the main translate flow
 * and the mistype-confirm flow (T22/B2) — the two differ only in the optional
 * detected-language banner and whether inline grammar is offered, both passed in
 * so behavior is unchanged for each caller.
 */
async function sendTranslationCard(
  ctx: BotContext,
  opts: {
    output: TranslateOutput;
    lang: SupportedLang;
    nativeLang: string;
    needsReview: boolean;
    isSentence: boolean;
    inputType: InputType;
    effectiveTemplate: ReturnType<typeof resolveTemplate>;
    isAlreadySaved: boolean;
    contextHint?: string;
    /** Main flow only: prefixes a "detected language" banner when it differs from native. */
    detectedLang?: string;
    /** Main flow offers inline grammar for phrases; the mistype flow never does. */
    withInlineGrammar: boolean;
  },
): Promise<void> {
  const { output, lang, nativeLang, needsReview, isSentence, inputType, effectiveTemplate, isAlreadySaved } = opts;

  ctx.session.pendingTranslation = output;

  const body = isSentence
    ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, lang, nativeLang, needsReview)}`
    : renderTranslation(output, lang, effectiveTemplate.fields, nativeLang, needsReview);
  const card =
    opts.detectedLang && opts.detectedLang !== nativeLang
      ? `${t("detectedLang", lang, { lang: getLanguageName(opts.detectedLang, lang) })}\n${body}`
      : body;

  const cardMsg = await ctx.reply(card, { parse_mode: "HTML" });

  const showGrammarButton =
    inputType !== "word" && (inputType === "sentence" || !effectiveTemplate.fields.grammarBreakdown);
  const hasInlineGrammar =
    opts.withInlineGrammar &&
    inputType === "phrase" &&
    effectiveTemplate.fields.grammarBreakdown &&
    hasGrammarBreakdownData(output);
  const showEtymologyButton = isEtymologyEligible(inputType, output.sourceLang, nativeLang);
  const keyboard = buildTranslationKeyboard(
    lang,
    cardMsg.message_id,
    isAlreadySaved,
    showGrammarButton,
    hasInlineGrammar,
    showEtymologyButton,
  );
  await ctx.api.editMessageReplyMarkup(ctx.chat!.id, cardMsg.message_id, { reply_markup: keyboard });

  ctx.session.pendingCardMsgId = cardMsg.message_id;

  const inlineBreakdown = hasInlineGrammar ? collectGrammarBreakdown(output) : undefined;
  setTranslationEntry(ctx.session, cardMsg.message_id, {
    output,
    inputType,
    contextHint: opts.contextHint,
    grammarBreakdown: inlineBreakdown,
  });
}

/**
 * The single translation pipeline (Fable T22/B2). Both entry points — the main
 * text flow (`handleTranslateText`) and the mistype-confirm flow
 * (`handleMistypeConfirmCallback`) — run through this after they have resolved
 * direction, quota, and shown the loading message. It resolves the model, loads
 * the template, runs `translateWithContext`, handles the clarification branch,
 * logs the request, records timing (main flow only), and renders the card.
 *
 * The two flows differ only in the options below; everything else is shared, so
 * a pipeline change is made once. The pipeline never answers a callback query —
 * the caller does that afterwards if it is a callback handler.
 */
async function runTranslationPipeline(
  ctx: BotContext,
  params: {
    word: string;
    sourceLang: string;
    targetLangs: string[];
    nativeLang: string;
    lang: SupportedLang;
    subscriptionPlan: string;
    creditCost: number;
    classification: ReturnType<typeof classifyInput>;
    isSentence: boolean;
    loadingMsg: { message_id: number };
    learningLangs: string[];
    contextHint?: string;
    /** Main flow passes the detector's confidence; the mistype flow omits it. */
    detectionConfidence?: number;
    /** Mistype flow: the user already confirmed, so never re-question the input. */
    skipInputCorrection?: boolean;
    /** Main flow only: banner shown when the detected language differs from native. */
    detectedLang?: string;
    /** Main flow offers inline grammar for phrases; the mistype flow never does. */
    withInlineGrammar: boolean;
    /** Main flow records request-timing telemetry; the mistype flow does not. */
    timing?: { preflightMs: number; totalStart: number };
  },
): Promise<void> {
  const {
    word,
    sourceLang,
    targetLangs,
    nativeLang,
    lang,
    subscriptionPlan,
    creditCost,
    classification,
    isSentence,
    loadingMsg,
    learningLangs,
    contextHint,
    detectionConfidence,
    skipInputCorrection,
    detectedLang,
    withInlineGrammar,
    timing,
  } = params;

  let model: string | undefined;
  let dbLookupMs = 0;
  let aiRequestMs = 0;
  try {
    model = await resolveDefaultAIModel(ctx.services?.settings, subscriptionPlan);

    // Load user's template for template-aware output resolution (Task 32)
    const dbLookupStart = Date.now();
    const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, classification.type, word.length);
    const effectiveTemplate = resolveTemplate(userTpl);
    dbLookupMs = Date.now() - dbLookupStart;

    // For sentences, skip dictionary context lookup (no learnable word to enrich)
    const lookupContextFn = isSentence ? async () => [] : ctx.services.contextLookup;

    const stopTimer = translationDuration.startTimer();
    const aiStart = Date.now();
    const decision = await withTimeout(
      translateWithContext(
        {
          word,
          sourceLang,
          targetLangs,
          nativeLang,
          model,
          topic: contextHint,
          userId: ctx.user.id,
          interfaceLang: lang,
          ...(detectionConfidence !== undefined ? { detectionConfidence } : {}),
          outputConfig,
          inputType: classification.type,
          correctionPolicy: {
            // Task 70 — let the main call flag unrecognized/fabricated headwords.
            assessSourceExistence: true,
            ...(skipInputCorrection ? { skipInputCorrection: true } : {}),
          },
        },
        {
          lookupContext: lookupContextFn,
          generateObjectFn: ctx.services.ai.generateObject,
        },
      ),
      LONG_OP_TIMEOUT_MS,
    );
    aiRequestMs = Date.now() - aiStart;
    stopTimer();

    if (decision.status === "needs_clarification") {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
      await showTranslationClarification(ctx, {
        word,
        contextHint,
        sourceLang,
        targetLangs,
        nativeLang,
        learningLangs,
        ...(detectionConfidence !== undefined ? { detectionConfidence } : {}),
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
    if (output.correction) {
      inputCorrectionCounter.inc({ outcome: "auto_corrected", input_type: classification.type });
    }
    await ctx.services.translationRequestRepository.logTranslationRequest(
      ctx.user.id,
      word,
      sourceLang,
      targetLangs,
      creditCost,
    );

    if (timing) {
      ctx.services.requestTimingRepository
        .record({
          userId: ctx.user.id,
          requestType: "translate",
          preflightMs: timing.preflightMs,
          dbLookupMs,
          aiRequestMs,
          totalMs: Date.now() - timing.totalStart,
          modelId: recordedModelId,
          sourceLang,
          targetLangs,
          inputType: classification.type,
          success: true,
        })
        .catch((err: unknown) => {
          logger.warn({ err }, "Failed to record request timing");
        });
    }

    // Delete loading message
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    const isAlreadySaved = await resolveIsAlreadySaved(ctx, output, isSentence);

    await sendTranslationCard(ctx, {
      output,
      lang,
      nativeLang,
      needsReview,
      isSentence,
      inputType: classification.type,
      effectiveTemplate,
      isAlreadySaved,
      contextHint,
      detectedLang,
      withInlineGrammar,
    });
  } catch (err) {
    translationCounter.inc({ status: "error" });
    logger.error({ err, word }, "Translation failed");

    if (timing) {
      ctx.services.requestTimingRepository
        .record({
          userId: ctx.user.id,
          requestType: "translate",
          preflightMs: timing.preflightMs,
          dbLookupMs,
          aiRequestMs: 0,
          totalMs: Date.now() - timing.totalStart,
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
    }

    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(isUserFacingTimeout(err) ? t("loadingTimeout", lang) : t("translationError", lang));
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
  clearPendingClarification(ctx);

  ctx.services.languageDetectionRepository
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
  const creditCost = await ensureAiQuota(ctx, subscriptionPlan, lang, "translate");
  if (creditCost === null) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Show loading message
  const loadingMsg = await ctx.reply(t("translating", lang));

  await runTranslationPipeline(ctx, {
    word: pendingWord,
    sourceLang,
    targetLangs,
    nativeLang,
    lang,
    subscriptionPlan,
    creditCost,
    classification,
    isSentence,
    loadingMsg,
    learningLangs: normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []),
    contextHint: pendingContextHint,
    // The user already confirmed the language / chose a correction (or "translate
    // as written") — never re-ask, and never offer inline grammar on this path.
    skipInputCorrection: true,
    withInlineGrammar: false,
  });

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
}
