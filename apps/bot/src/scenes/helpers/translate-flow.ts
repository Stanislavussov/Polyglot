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
  getMonthlyWindowStart,
  type InputType,
  isSupported,
  isSupportedLanguage,
  logger,
  needsAiArbitration,
  needsDictionaryVerification,
  resolveDirectionFromSource,
  resolveEntitlements,
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
import {
  inputCorrectionCounter,
  type TranslationPhase,
  translationCounter,
  translationDuration,
  translationPhaseDuration,
  unrecognizedWordCounter,
} from "../../metrics.js";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import {
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { classifyInput } from "../../utils/classify-input.js";
import {
  isUserFacingTimeout,
  LONG_OP_TIMEOUT_MS,
  sendTypingIndicator,
  startTypingKeepalive,
  TRANSLATION_BUDGET_MS,
  withTimeout,
} from "../../utils/long-op.js";
import { cleanupTechnicalMessages, replyTechnical } from "../../utils/message-cleanup.js";
import { parseTranslateInput } from "../../utils/parse-translate-input.js";
import { encodeTranslateRetryText, replyWithRetry } from "../../utils/retry-action.js";
import { validateTranslatableText } from "../../utils/validate-text-input.js";
import { buildUpgradeKeyboard } from "./subscription.helper.js";
import {
  clearPendingClarification,
  getUserLanguageGroup,
  isEtymologyEligible,
  normalizeLearningLangs,
  showAddLanguagePrompt,
} from "./translate-mode.shared.js";
import { setTranslationEntry } from "./translation-map.helper.js";

/**
 * Translation quota — a monthly (calendar-UTC) window, distinct from the daily
 * credit meter (`ensureAiQuota`) that governs the other paid AI calls. Free plans
 * allow N translations per calendar month; unlimited plans and admin/tester roles
 * skip the ledger entirely. Returns the credit cost to log on success, or null
 * when the quota is exhausted (after replying with the limit notice + upgrade
 * CTA — the caller must then abort).
 */
async function ensureTranslationQuota(
  ctx: BotContext,
  plan: SubscriptionPlan,
  lang: SupportedLang,
): Promise<number | null> {
  const creditCost = 1;
  const planConfig = await ctx.services.settings.getPlanLimit(plan);
  const entitlements = resolveEntitlements({
    audienceGroup: ctx.user.audienceGroup,
    plan,
    planConfig,
    planFeatures: [],
  });

  if (entitlements.translationsPerMonth === null) {
    return creditCost;
  }

  const usedCredits = await ctx.services.translationRequestRepository.getUserCreditsInWindow(
    ctx.user.id,
    getMonthlyWindowStart(),
  );
  if (usedCredits + creditCost > entitlements.translationsPerMonth) {
    await replyTechnical(ctx, t("rateLimitExceeded", lang), { reply_markup: buildUpgradeKeyboard(lang) });
    return null;
  }

  return creditCost;
}

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

/**
 * Task 70 cross-language guard. A `needs_clarification` of reason
 * `unrecognized_word` carries the AI's spelling correction; when that correction
 * is written in the exclusive alphabet of a SUPPORTED language the user does not
 * study, the "unrecognized word" is really an out-of-set language the closed-set
 * detector coerced to a studied one — e.g. Russian-lettered Kazakh "кыздарай",
 * corrected to "қыздар-ай" whose "қ" exists only in Kazakh. Returns that
 * language so the flow can offer "add and translate" instead of a nonsensical
 * spelling fix. Returns undefined for genuine same-alphabet typos (Slovak vs
 * Czech share their alphabet and cannot be told apart by letters alone — those
 * need a dictionary/AI signal the alphabet check deliberately does not fake).
 */
function outOfSetLanguageFromCorrection(
  ambiguity: TranslationAmbiguity,
  nativeLang: string,
  learningLangs: string[],
): string | undefined {
  if (ambiguity.reason !== "unrecognized_word") {
    return undefined;
  }
  const correction = (ambiguity.options ?? []).find((option) => option.kind === "typo_correction")?.correctedText;
  if (!correction) {
    return undefined;
  }
  const outOfSetLang = detectOutOfSetByAlphabet(correction, [nativeLang, ...learningLangs]);
  return outOfSetLang && isSupportedLanguage(outOfSetLang) ? outOfSetLang : undefined;
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

  await replyTechnical(ctx, message, { reply_markup: keyboard });
}

/**
 * Records one phase of the translate path. Timer-only and fire-and-forget by
 * construction — prom-client observation is synchronous, so instrumentation
 * never adds awaited I/O to the request path. The `TranslationPhase` parameter
 * type is what keeps the metric's label cardinality bounded to the declared set.
 */
function observeTranslationPhase(phase: TranslationPhase, elapsedMs: number): void {
  translationPhaseDuration.observe({ phase }, elapsedMs / 1000);
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
  const settings = await getRequestSettings(ctx, ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);
  const subscriptionPlan = ctx.user.subscriptionPlan ?? "free";
  const parsed = parseTranslateInput(word, ctx.message?.entities);
  const cleanWord = parsed.text;
  const contextHint = parsed.contextHint;

  if (cleanWord.length === 0) {
    await replyTechnical(ctx, t("contextMarkerNeedsText", lang));
    return;
  }

  // A text message was already swept centrally before any handler ran, and
  // sweeping again here would delete a technical message sent for THIS update —
  // the one-time main-menu hint, which mainKeyboardMiddleware attaches to the
  // very message being translated. Callback-driven entries (retry, activation
  // nudge) bypass the central sweep, so they still clear the chat here.
  if (!ctx.message) {
    await cleanupTechnicalMessages(ctx);
  }

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
    await replyTechnical(ctx, t(keyByReason[reason], lang, { max: "500" }));
    return;
  }

  if (learningLangs.length === 0) {
    await replyTechnical(ctx, t("translationUnavailable", lang));
    return;
  }

  // Clear reminder flag (Task 58 — source lang menu removed; flag kept for compat).
  if (ctx.session.needsTranslateReminder) {
    ctx.session.needsTranslateReminder = false;
  }

  // Language detection: always detect for each word (don't rely on previous selection)
  const allCandidates = [nativeLang, ...learningLangs];
  const candidatesWithEnglish = ["en", ...allCandidates];

  // Confidence-aware detection: sync first (script + diacritics + franc).
  //
  // For MULTI-WORD input, English is included as a candidate even when the user
  // does not study it: English is a universally valid source (translated into the
  // learning langs), and leaving it out let an English phrase get franc-coerced to
  // the nearest studied Latin language (e.g. German), which then failed downstream
  // as an "unrecognized German word". Adding `en` lets franc pick English for a
  // phrase it confidently reads as English (e.g. "I will get you" → en).
  //
  // Scoped to multi-word only, deliberately: `en` only helps the franc pass (3+
  // words), while for a single ASCII word it would turn a confident sole-Latin
  // candidate into a shared-script tie and force every such word into the async
  // AI pass — an unwanted latency/cost expansion. Single words keep the original
  // candidate set and their existing escalation path.
  //
  // franc still misreads some short English phrases as a sibling Latin language
  // (e.g. "That will get you" → de, deu:1 vs eng:0.78); those are caught by the
  // AI-arbitration escalation below, not the candidate set.
  const isMultiWord = cleanWord.trim().split(/\s+/).filter(Boolean).length > 1;
  const syncCandidates = isMultiWord ? candidatesWithEnglish : allCandidates;
  const detectionStart = Date.now();
  let detection: DetectionResult = detectLanguageWithConfidence(cleanWord, syncCandidates);

  // Escalate to async (dictionary sweep + Wiktionary + AI) when sync is
  // ambiguous, when a confident single-word result rests on heuristics alone and
  // needs dictionary confirmation (e.g. "Strohá" is not English), or when a
  // confident multi-word Latin result rests on franc and a close runner-up makes
  // it coercion-prone (e.g. English "That will get you" mis-read as German) — the
  // async pass then lets the AI's open detection override franc.
  if (
    detection.language === undefined ||
    needsDictionaryVerification(cleanWord, detection) ||
    needsAiArbitration(cleanWord, detection, candidatesWithEnglish)
  ) {
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
  // `detection` spans the sync pass plus the optional async escalation
  // (dictionary sweep + Wiktionary + AI), i.e. the whole cost of deciding the
  // source language. Kept as a value so `pre_ai` can subtract it out below.
  const detectionMs = Date.now() - detectionStart;
  observeTranslationPhase("detection", detectionMs);

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
  //
  // The franc pass runs an UNCONSTRAINED francAll that readily prefers a close
  // sibling of an in-set language (Czech → Croatian, Russian → Bulgarian), so it
  // must NOT override a confident closed-set detection — otherwise legitimate
  // in-set input (e.g. Czech "Výdaje ČR na obranu") gets blocked as its sibling.
  // A genuinely out-of-set phrase almost never yields a *confident* in-set
  // detection, so gating franc on `detection.language === undefined` is safe. The
  // dictionary/AI and alphabet-exclusion signals stay unconditional — they are
  // conservative and reliable even against a confident-but-wrong coercion.
  const outOfSetLang =
    detection.outOfSetLanguages?.[0] ??
    detectOutOfSetByAlphabet(cleanWord, candidatesWithEnglish) ??
    (detection.language === undefined ? detectOutOfSetLanguage(cleanWord, candidatesWithEnglish) : undefined);
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
    await replyTechnical(ctx, t("languageNotSelected", lang, { lang: getLanguageName(outOfSetLang, lang) }));
    return;
  }

  let sourceLang: string;
  let targetLangs: string[];
  let detectedLang: string | undefined;
  // True only when the source language was GUESSED via a heuristic fallback
  // rather than resolved confidently — i.e. the rare, genuinely-doubtful cases
  // where a "translate from" override menu is worth offering. Confident
  // detection (the common path) leaves this false, so the menu stays rare.
  let sourceLanguageDoubtful = false;

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
      // Detected a language that is neither native nor a learning language and
      // is not English — fall back to a script-aware guess. Doubtful.
      const fallback = resolveTranslationDirection({
        text: cleanWord,
        nativeLang,
        learningLangs,
      });
      sourceLang = fallback.sourceLang;
      targetLangs = fallback.targetLangs;
      detectedLang = fallback.detectedLang;
      sourceLanguageDoubtful = true;
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

    await replyTechnical(ctx, promptText, { reply_markup: keyboard });
    return;
  } else if (detection.ambiguousCandidates && detection.ambiguousCandidates.length > 0) {
    // Weak ambiguity such as shared Latin script is not enough to interrupt the
    // user, but the source is a guess — offer the "translate from" override.
    const fallback = resolveTranslationDirection({
      text: cleanWord,
      nativeLang,
      learningLangs,
    });
    sourceLang = fallback.sourceLang;
    targetLangs = fallback.targetLangs;
    detectedLang = fallback.detectedLang;
    sourceLanguageDoubtful = true;
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

    await replyTechnical(ctx, warningText, { reply_markup: keyboard });
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
    sourceLanguageDoubtful,
    withInlineGrammar: true,
    timing: { preflightMs, totalStart, detectionMs },
  });
}

/**
 * Whether the translated headword already exists in the user's default
 * dictionary. Shared by both translation entry points (T22/B2) — identical FK
 * resolution + duplicate lookup that was previously copied per handler.
 *
 * The two SELECTs below are DATA-DEPENDENT and must stay sequential: the row
 * returned by `findByOriginalAndSource` supplies the `existing.id` that
 * `entryBelongsToDefault` takes as input (and when there is no row, the second
 * query must not run at all). They look like an obvious `Promise.all` candidate
 * — they are not.
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
    /** Native + learning set — source of the "translate from" override choices. */
    learningLangs: string[];
    needsReview: boolean;
    isSentence: boolean;
    inputType: InputType;
    effectiveTemplate: ReturnType<typeof resolveTemplate>;
    isAlreadySaved: boolean;
    contextHint?: string;
    /** Main flow only: prefixes a "detected language" banner when it differs from native. */
    detectedLang?: string;
    /** Main flow only: when true, append the doubtful-source "translate from" override menu. */
    sourceLanguageDoubtful?: boolean;
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

  // Doubtful-source override: offer the user's other languages (native + learning,
  // minus the guessed source) as forced-source retranslation choices. Only when the
  // detector fell back to a guess — rare by construction.
  const sourceOverrideLangs = opts.sourceLanguageDoubtful
    ? getUserLanguageGroup(nativeLang, opts.learningLangs).filter((code) => code !== output.sourceLang)
    : undefined;
  if (sourceOverrideLangs && sourceOverrideLangs.length > 0) {
    ctx.services.languageDetectionRepository
      .record({
        userId: ctx.user.id,
        eventType: "override_shown",
        word: output.original,
        sourceLang: output.sourceLang,
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "Failed to record language detection event");
      });
  }

  const keyboard = buildTranslationKeyboard(
    lang,
    cardMsg.message_id,
    isAlreadySaved,
    showGrammarButton,
    hasInlineGrammar,
    showEtymologyButton,
    sourceOverrideLangs,
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
    /**
     * Main flow only: true when the source language was a heuristic guess, so the
     * card offers a "translate from" override menu. Omitted (false) on the mistype
     * / override retranslation path — a user-forced source is never doubtful, which
     * also prevents the override menu from looping.
     */
    sourceLanguageDoubtful?: boolean;
    /** Main flow offers inline grammar for phrases; the mistype flow never does. */
    withInlineGrammar: boolean;
    /** Main flow records request-timing telemetry; the mistype flow does not. */
    timing?: { preflightMs: number; totalStart: number; detectionMs: number };
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
    sourceLanguageDoubtful,
    withInlineGrammar,
    timing,
  } = params;

  let model: string | undefined;
  let dbLookupMs = 0;
  let aiRequestMs = 0;
  try {
    // The default-model resolution and the user's template (Task 32, for
    // template-aware output resolution) are independent reads — neither feeds
    // the other — so they run concurrently instead of back to back.
    //
    // `Promise.all` rejects on the first rejection, which matches the previous
    // sequential behaviour: either failure throws out of this try block into the
    // catch below and yields the same user-facing error.
    //
    // `model` is assigned twice on purpose. The tap publishes it as soon as it
    // resolves, so the error path can still report `modelId` when the template
    // read is what rejected; the reassignment from the resolved tuple is what
    // narrows it back to `string` for the call below, which a write inside a
    // closure cannot do.
    const dbLookupStart = Date.now();
    const [resolvedModel, savedTemplate] = await Promise.all([
      resolveDefaultAIModel(ctx.services?.settings, subscriptionPlan).then((resolved) => {
        model = resolved;
        return resolved;
      }),
      ctx.services.translationTemplateRepository.getByUserId(ctx.user.id),
    ]);
    model = resolvedModel;
    const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
    const outputConfig = resolveOutputConfig(userTpl, classification.type, word.length);
    const effectiveTemplate = resolveTemplate(userTpl);
    // `pre_ai` = everything from the update arriving to the AI call, minus
    // `detection`. Observed HERE rather than earlier so it actually covers the
    // whole pre-AI stretch — including the loading-message round-trip and the
    // concurrent model/template reads just above, which a boundary drawn before
    // this block would leave attributed to no phase at all. Only the main flow
    // passes `timing`; the mistype-confirm entry point is a separate update that
    // has already done its own pre-AI work.
    if (timing) {
      observeTranslationPhase("pre_ai", Date.now() - timing.totalStart - timing.detectionMs);
    }
    dbLookupMs = Date.now() - dbLookupStart;

    // For sentences, skip dictionary context lookup (no learnable word to enrich)
    const lookupContextFn = isSentence ? async () => [] : ctx.services.contextLookup;

    const stopTimer = translationDuration.startTimer();
    const aiStart = Date.now();
    // Hold "typing…" open for the whole translation so the user sees progress
    // while the pipeline runs (the loader message already shows too).
    const stopTyping = startTypingKeepalive(ctx);
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
          // An ABSOLUTE deadline anchored at `aiStart` — the same instant the
          // outer `withTimeout` guard below starts counting. Core never
          // re-anchors, so the dictionary lookup that runs inside
          // `translateWithContext` before the pipeline begins is spent from this
          // budget rather than silently pushing the deadline out past the guard.
          deadlineAt: aiStart + TRANSLATION_BUDGET_MS,
        },
        {
          lookupContext: lookupContextFn,
          generateObjectFn: ctx.services.ai.generateObject,
          // `generate`/`validate`/`judge` happen inside the pipeline and are
          // invisible from here; core reports them through this sink. Deliberately
          // NOT also timed on this side — that would double-count `generate`.
          onPhase: observeTranslationPhase,
        },
      ),
      LONG_OP_TIMEOUT_MS,
    ).finally(stopTyping);
    aiRequestMs = Date.now() - aiStart;
    stopTimer();
    // Everything from here on is post-AI: the request log, the duplicate-lookup
    // SELECTs and the Telegram round-trips that render the card.
    const postAiStart = Date.now();

    if (decision.status === "needs_clarification") {
      await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

      // A Task 70 "unrecognized word" whose correction is actually in an
      // unstudied supported language (same-script coercion, e.g. "кыздарай" →
      // Kazakh "қыздар-ай") is an out-of-set language, not a typo — offer
      // "add and translate" instead of a nonsensical spelling correction.
      const outOfSetLang = outOfSetLanguageFromCorrection(decision.ambiguity, nativeLang, learningLangs);
      if (outOfSetLang) {
        await showAddLanguagePrompt(ctx, lang, outOfSetLang, word, contextHint);
        return;
      }

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
      learningLangs,
      needsReview,
      isSentence,
      inputType: classification.type,
      effectiveTemplate,
      isAlreadySaved,
      contextHint,
      detectedLang,
      sourceLanguageDoubtful,
      withInlineGrammar,
    });

    observeTranslationPhase("post_ai", Date.now() - postAiStart);
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

    // A timeout is transient — the same input usually succeeds on a second
    // attempt — so the notice carries a one-tap retry instead of asking the user
    // to retype the word. A hard failure gets the plain error: re-running it
    // would just fail the same way.
    if (isUserFacingTimeout(err)) {
      await replyWithRetry(ctx, t("loadingTimeout", lang), lang, {
        kind: "translate",
        text: encodeTranslateRetryText(word, contextHint),
      });
      return;
    }
    await replyTechnical(ctx, t("translationError", lang));
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
    // Guard with `ctx.callbackQuery`: this runs on the text path too (the
    // clarification "add context" reply routes here via runClarifiedTranslation),
    // where there is no callback query. `ctx.answerCallbackQuery()` throws
    // synchronously in that case (grammy's orThrow), so a `.catch()` cannot save
    // it — the guard must come first.
    if (ctx.callbackQuery) {
      await ctx
        .answerCallbackQuery({
          text: "⚠️ Session expired. Please translate the word again.",
          show_alert: true,
        })
        .catch(() => {});
    }
    return;
  }

  // Answer the callback up front, before the multi-second translation pipeline,
  // so Telegram does not expire the query ("query is too old"). Only meaningful
  // on the callback path — this same function also runs on the text path (the
  // "add context" clarification reply), which has no callback query. Answering it
  // there throws synchronously (grammy's orThrow), and because the throw precedes
  // the promise, `.catch()` never attaches — hence the `ctx.callbackQuery` guard.
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => {});
  }

  const settings = await getRequestSettings(ctx, ctx.user.id);
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
  const creditCost = await ensureTranslationQuota(ctx, subscriptionPlan, lang);
  if (creditCost === null) {
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

  const settings = await getRequestSettings(ctx, ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  await ctx.answerCallbackQuery();
  await replyTechnical(ctx, t("translateModeHint", lang));
}
