import { logEvent as defaultLogEvent, errorFields } from "../../observability/events.js";
import type { AIPort } from "../../ports/ai.port.js";
import type { LanguageDetectionRepository } from "../../ports/language-detection.repository.js";
import type { SettingsPort } from "../../ports/settings.port.js";
import type { TranslationTemplateRepository } from "../../ports/translation-template.repository.js";
import type { UserRepository } from "../../ports/user.repository.js";
import { resolveDefaultAIModel } from "../../shared/ai-model.js";
import { AICircuitOpenError, AITimeoutError } from "../../shared/errors.js";
import { resolveOutputConfig } from "../../shared/translation-template.service.js";
import { translateWithContext } from "../context-enrichment/context-enrichment.service.js";
import type { ContextEnrichmentDeps, ContextLookupFn } from "../context-enrichment/types.js";
import { checkTranslationQuota, type QuotaPorts, type QuotaSubject } from "../entitlements/quota.js";
import { isSupported } from "../i18n/i18n.js";
import { isSupportedLanguage } from "../i18n/language-registry.js";
import type { SupportedLang } from "../i18n/types.js";
import { classifyInput } from "../input-analysis/input-analyzer.js";
import {
  detectLanguageWithConfidence,
  detectLanguageWithConfidenceAsync,
  needsAiArbitration,
  needsDictionaryVerification,
} from "../language-detect/detect-language.js";
import type { DetectionResult, FindWordLanguagesFn } from "../language-detect/types.js";
import { buildClarificationView, type ClarificationView, clarifiedTargetLangs } from "../translation/clarification.js";
import type { InputType, TranslateOutput, TranslationAmbiguity } from "../translation/types.js";
import { decideDirection, detectOutOfSetSource, outOfSetLanguageFromCorrection } from "./language.js";
import { parseTranslateInput } from "./parse-input.js";
import {
  MAX_TRANSLATE_INPUT_LENGTH,
  type TranslateInputValidationReason,
  validateTranslatableText,
} from "./validate-input.js";

export type TranslationChannel = "bot" | "web";

/** The hard stop a waiting user gets; the bot's LONG_OP_TIMEOUT_MS. */
export const TRANSLATION_HARD_TIMEOUT_MS = 90_000;
/** Below the hard stop so the pipeline's tail can wind down and return its best validated result first. */
export const TRANSLATION_PIPELINE_BUDGET_MS = TRANSLATION_HARD_TIMEOUT_MS - 3_000;

/** What the user chose after a question; stateless, so it round-trips through the client. */
export interface TranslationAnswer {
  sourceLang?: string;
  asWritten?: boolean;
  context?: string;
}

export interface RunTranslationRequest {
  user: QuotaSubject;
  text: string;
  channel: TranslationChannel;
  answer?: TranslationAnswer;
}

export interface RunTranslationDeps {
  settings: SettingsPort;
  users: Pick<UserRepository, "getSettings">;
  translationRequests: QuotaPorts["translationRequests"];
  subscriptions?: QuotaPorts["subscriptions"];
  templates: Pick<TranslationTemplateRepository, "getByUserId">;
  ai: Pick<AIPort, "generateObject" | "generateText">;
  contextLookup: ContextLookupFn;
  wordLanguageSweep?: FindWordLanguagesFn;
  languageDetections?: Pick<LanguageDetectionRepository, "record">;
  now?: () => number;
  logEvent?: typeof defaultLogEvent;
  onPhase?: ContextEnrichmentDeps["onPhase"];
}

export type TranslationRejectReason = TranslateInputValidationReason | "needs_text" | "invalid_language";

export type TranslationOutcome =
  | {
      status: "done";
      output: TranslateOutput;
      sourceLang: string;
      targetLangs: string[];
      inputType: InputType;
      needsReview: boolean;
      creditCost: number;
      translationRequestId: number;
      detectedLang: string | undefined;
      sourceLanguageDoubtful: boolean;
      contextHint: string | undefined;
    }
  | { status: "rejected"; reason: TranslationRejectReason; maxLength: number }
  | { status: "no_languages" }
  | { status: "limit"; reason: "plan" | "daily_ceiling"; resetAt: Date }
  | {
      status: "needs_language";
      /** `ambiguous`: the word exists in several of the user's languages; `unrecognized`: in none of them. */
      kind: "ambiguous" | "unrecognized";
      text: string;
      contextHint: string | undefined;
      candidates: string[];
    }
  | {
      status: "add_language";
      lang: string;
      /** False when the language cannot be added at all (not a supported language). */
      supported: boolean;
      text: string;
      contextHint: string | undefined;
    }
  | {
      status: "needs_clarification";
      text: string;
      contextHint: string | undefined;
      sourceLang: string;
      targetLangs: string[];
      inputType: InputType;
      ambiguity: TranslationAmbiguity;
      view: ClarificationView;
    }
  | { status: "timeout" };

class HardTimeout extends Error {}

function withHardTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HardTimeout()), TRANSLATION_HARD_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function languageGroup(nativeLang: string, learningLangs: readonly string[]): string[] {
  return [nativeLang, ...learningLangs].filter((code, index, all) => all.indexOf(code) === index);
}

/**
 * One translation request for any channel: validate, resolve the language, gate the
 * quota, translate. Every question it cannot answer alone comes back as an outcome;
 * the channel renders it and re-calls with `answer`.
 */
export async function runTranslation(
  request: RunTranslationRequest,
  deps: RunTranslationDeps,
): Promise<TranslationOutcome> {
  const now = deps.now ?? Date.now;
  const log = deps.logEvent ?? defaultLogEvent;
  const { user, channel, answer } = request;
  const totalStart = now();

  const settings = await deps.users.getSettings(user.id);
  const interfaceLang: SupportedLang = isSupported(settings?.interfaceLang ?? "en")
    ? (settings?.interfaceLang as SupportedLang)
    : "en";
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = (settings?.learningLangs ?? []).filter((code) => code !== nativeLang);

  const parsed = parseTranslateInput(request.text);
  const text = parsed.text;
  const contextHint = answer?.context ?? parsed.contextHint;
  const reject = (reason: TranslationRejectReason): TranslationOutcome => ({
    status: "rejected",
    reason,
    maxLength: MAX_TRANSLATE_INPUT_LENGTH,
  });
  if (text.length === 0) return reject(parsed.contextHint ? "needs_text" : "empty");
  const validation = validateTranslatableText(text);
  if (!validation.valid) return reject(validation.reason ?? "empty");
  if (learningLangs.length === 0) return { status: "no_languages" };

  const recordDetection = (
    eventType: "warning_shown" | "detected" | "out_of_set",
    sourceLang: string,
    targetLangs?: string[],
  ): void => {
    deps.languageDetections
      ?.record({ userId: user.id, eventType, word: text, sourceLang, ...(targetLangs ? { targetLangs } : {}) })
      .catch((err: unknown) => {
        log("language_detection.record_failed", errorFields(err), "warn");
      });
  };

  let model: string | undefined;
  const getModel = async (): Promise<string> => {
    model ??= await resolveDefaultAIModel(deps.settings, user.subscriptionPlan);
    return model;
  };

  let sourceLang: string;
  let targetLangs: string[];
  let detectedLang: string | undefined;
  let doubtful = false;
  let detection: DetectionResult | undefined;
  // An answered question is a re-run: it skips the typo/existence questions so the
  // user is never asked the same thing twice.
  const answered =
    answer !== undefined &&
    (answer.sourceLang !== undefined || answer.asWritten === true || answer.context !== undefined);

  if (answer?.sourceLang !== undefined) {
    // The answer came back through the client, so it is checked, never trusted.
    if (!languageGroup(nativeLang, [...learningLangs, "en"]).includes(answer.sourceLang)) {
      return reject("invalid_language");
    }
    sourceLang = answer.sourceLang;
    targetLangs = clarifiedTargetLangs(sourceLang, nativeLang, learningLangs, [nativeLang]);
  } else {
    const candidates = [nativeLang, ...learningLangs];
    const candidatesWithEnglish = ["en", ...candidates];
    // English joins the sync pass for multi-word input only: franc coerces an English
    // phrase to the nearest studied Latin language without it, while for one ASCII
    // word it would force every such word into the async AI pass.
    const isMultiWord = text.split(/\s+/).filter(Boolean).length > 1;
    const detectionStart = now();
    detection = detectLanguageWithConfidence(text, isMultiWord ? candidatesWithEnglish : candidates);
    if (
      detection.language === undefined ||
      needsDictionaryVerification(text, detection) ||
      needsAiArbitration(text, detection, candidatesWithEnglish)
    ) {
      const aiModel = await getModel();
      detection = await detectLanguageWithConfidenceAsync(text, candidatesWithEnglish, {
        contextLookup: deps.contextLookup,
        ...(deps.wordLanguageSweep ? { findWordLanguages: deps.wordLanguageSweep } : {}),
        aiGenerate: async (prompt) => (await deps.ai.generateText(prompt, aiModel)).trim(),
      });
    }
    log("translation.language_detected", {
      word: text,
      channel,
      detectedLang: detection.language,
      confidence: detection.confidence,
      ambiguousCandidates: detection.ambiguousCandidates,
      outOfSetLanguages: detection.outOfSetLanguages,
      evidenceCount: detection.evidence.length,
      evidenceStrategies: detection.evidence.map((entry) => entry.strategy),
      detectionMs: now() - detectionStart,
    });

    const outOfSetLang = detectOutOfSetSource(text, detection, candidatesWithEnglish);
    if (outOfSetLang) {
      const supported = isSupportedLanguage(outOfSetLang);
      if (!supported) recordDetection("out_of_set", outOfSetLang);
      return { status: "add_language", lang: outOfSetLang, supported, text, contextHint };
    }

    const direction = decideDirection(text, detection, nativeLang, learningLangs);
    if (direction.kind !== "resolved") {
      recordDetection("warning_shown", direction.fallback.sourceLang, direction.fallback.targetLangs);
      return direction.kind === "ambiguous"
        ? { status: "needs_language", kind: "ambiguous", text, contextHint, candidates: direction.candidates }
        : {
            status: "needs_language",
            kind: "unrecognized",
            text,
            contextHint,
            candidates: languageGroup(direction.fallback.sourceLang, languageGroup(nativeLang, learningLangs)),
          };
    }
    ({ sourceLang, targetLangs, detectedLang } = direction);
    doubtful = direction.doubtful;
    if (detection.language !== undefined) recordDetection("detected", sourceLang, targetLangs);
  }

  const classification = classifyInput(text);
  const quota = await checkTranslationQuota(
    {
      settings: deps.settings,
      translationRequests: deps.translationRequests,
      ...(deps.subscriptions ? { subscriptions: deps.subscriptions } : {}),
    },
    user,
  );
  if (!quota.ok) {
    log("limit.reached", { userId: user.id, reason: quota.reason, channel });
    return { status: "limit", reason: quota.reason, resetAt: quota.resetAt };
  }
  log("translation.direction_resolved", {
    word: text,
    channel,
    contextHint,
    detectedLang,
    sourceLang,
    targetLangs,
    inputType: classification.type,
    wordCount: classification.wordCount,
    plan: user.subscriptionPlan,
    creditCost: quota.creditCost,
  });

  const [resolvedModel, template] = await Promise.all([getModel(), deps.templates.getByUserId(user.id)]);
  const userTpl = template ? { name: template.name, fields: template.fields } : null;
  const aiStart = now();
  let decision: Awaited<ReturnType<typeof translateWithContext>>;
  try {
    decision = await withHardTimeout(
      translateWithContext(
        {
          word: text,
          sourceLang,
          targetLangs,
          nativeLang,
          model: resolvedModel,
          userId: user.id,
          interfaceLang,
          ...(contextHint ? { topic: contextHint } : {}),
          // The confidence is what lets the AI preflight check the spelling and the language.
          ...(!answered && detection ? { detectionConfidence: detection.confidence } : {}),
          outputConfig: resolveOutputConfig(userTpl, classification.type, text.length),
          inputType: classification.type,
          correctionPolicy: { assessSourceExistence: true, ...(answered ? { skipInputCorrection: true } : {}) },
          deadlineAt: aiStart + TRANSLATION_PIPELINE_BUDGET_MS,
        },
        {
          lookupContext: classification.type === "sentence" ? async () => [] : deps.contextLookup,
          generateObjectFn: deps.ai.generateObject,
          ...(deps.onPhase ? { onPhase: deps.onPhase } : {}),
        },
      ),
    );
  } catch (err) {
    if (err instanceof HardTimeout || err instanceof AITimeoutError || err instanceof AICircuitOpenError) {
      log("translation.timeout", { word: text, channel, sourceLang, modelId: resolvedModel }, "warn");
      return { status: "timeout" };
    }
    throw err;
  }
  const aiRequestMs = now() - aiStart;

  if (decision.status === "needs_clarification") {
    const coerced = outOfSetLanguageFromCorrection(decision.ambiguity, nativeLang, learningLangs);
    if (coerced) return { status: "add_language", lang: coerced, supported: true, text, contextHint };
    log("translation.clarification_requested", {
      word: text,
      channel,
      sourceLang,
      targetLangs,
      inputType: classification.type,
      reason: decision.ambiguity.reason,
      optionKinds: (decision.ambiguity.options ?? []).map((option) => option.kind),
      detectionConfidence: detection?.confidence,
    });
    return {
      status: "needs_clarification",
      text,
      contextHint,
      sourceLang,
      targetLangs,
      inputType: classification.type,
      ambiguity: decision.ambiguity,
      view: buildClarificationView(decision.ambiguity, interfaceLang, nativeLang, learningLangs),
    };
  }

  const needsReview = decision.status === "needs_review";
  log("translation.completed", {
    word: text,
    channel,
    contextHint,
    sourceLang,
    targetLangs,
    inputType: classification.type,
    status: decision.status,
    needsReview,
    modelId: decision.status === "accepted" ? decision.quality.modelId : resolvedModel,
    requestedModelId: resolvedModel,
    corrected: decision.output.correction !== undefined,
    aiRequestMs,
    totalMs: now() - totalStart,
  });
  const translationRequestId = await deps.translationRequests.logTranslationRequest(
    user.id,
    text,
    sourceLang,
    targetLangs,
    quota.creditCost,
  );
  return {
    status: "done",
    output: decision.output,
    sourceLang,
    targetLangs,
    inputType: classification.type,
    needsReview,
    creditCost: quota.creditCost,
    translationRequestId,
    detectedLang,
    sourceLanguageDoubtful: doubtful,
    contextHint,
  };
}
