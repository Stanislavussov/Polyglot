/**
 * Translation Service — the single entry point for all translation operations.
 *
 * Flow:
 * 1. Detect structural ambiguity before generation
 * 2. Generate and retry only generation/schema failures
 * 3. Run deterministic validation for every input type
 * 4. Judge high-risk results with a different model family
 * 5. Repair only failing language blocks
 * 6. Return accepted, needs_clarification, or needs_review
 *
 * Does NOT save results — only returns them.
 * Knows nothing about the user — works only with text and languages.
 */

import { getLogger } from "../../logger.js";
import { analyzeInput } from "../input-analysis/input-analyzer.js";
import { validate } from "../validation/validation.service.js";
import { PREFLIGHT_DEFAULTS } from "./preflight.config.js";
import { buildPreflightPrompt } from "./preflight.prompt.js";
import { type PreflightResult, preflightResultSchema } from "./preflight.schema.js";
import {
  buildMetadataPrompt,
  buildMetadataStrictPrompt,
  buildSingleLanguagePrompt,
  buildSingleLanguageStrictPrompt,
  buildTranslationPrompt,
} from "./prompt.builder.js";
import { type SemanticJudgeResult, semanticJudgeSchema } from "./quality.schema.js";
import {
  buildLanguageTranslationSchema,
  buildMetadataSchema,
  buildTranslationResultSchema,
  translationResultSchema,
} from "./schemas/translation.schema.js";
import type {
  LanguageTranslation,
  QualityIssue,
  RiskLevel,
  TranslateInput,
  TranslateOutput,
  TranslationAmbiguity,
  TranslationDecision,
  TranslationOutputConfig,
  TranslationRequest,
  TranslationResult,
} from "./types.js";

const MAX_FULL_RETRIES = 2;
const MAX_TARGETED_REPAIRS = 2;
const PROMPT_VERSION = "translation-v1";
const SCHEMA_VERSION = 1;
const HIGH_RISK_SCORE = 3;
const MEDIUM_RISK_SCORE = 1;
const CONFIDENT_DETECTION_THRESHOLD = 0.85;
const COMMON_TRANSLATION_LANGS = new Set(["en", "cs", "ru", "de", "es", "fr", "it", "pt", "pl", "sk", "uk"]);
const RISKY_CONTEXT_PATTERN =
  /\b(idiom|slang|sarcasm|sarcastic|irony|ironic|profane|profanity|swear|swearing|offensive|vulgar|wordplay|pun|joke)\b/i;
const HIGH_RISK_POS = new Set(["idiom", "phrase", "proverb", "interjection"]);

/**
 * AI generation function signature — injected to avoid direct dependency
 * on the AI adapter package from core.
 */
export type GenerateObjectFn = <T>(
  prompt: string,
  schema: import("zod").ZodSchema<T>,
  model: string,
  options?: { userId?: number; frequencyPenalty?: number },
) => Promise<T>;

/**
 * Translate a single word or phrase into multiple target languages.
 *
 * This is the main entry point for all translation operations.
 *
 * @param input - Word, source/target languages, model ID
 * @param generateObjectFn - AI generation function (injected)
 * @returns TranslationDecision — accepted, needs_clarification, or needs_review
 */
export async function translate(
  input: TranslateInput,
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationDecision> {
  const analysis = analyzeInput(input.word);
  const normalizedInput: TranslateInput = {
    ...input,
    inputType: input.inputType ?? analysis.type,
  };
  const ambiguity = detectPreflightAmbiguity(normalizedInput, analysis.features);
  if (ambiguity) {
    return { status: "needs_clarification", ambiguity };
  }

  const preflightAmbiguity = await detectAIPreflightAmbiguity(normalizedInput, generateObjectFn);
  if (preflightAmbiguity) {
    return { status: "needs_clarification", ambiguity: preflightAmbiguity };
  }

  const request: TranslationRequest = {
    text: normalizedInput.word,
    sourceLang: normalizedInput.sourceLang,
    targetLangs: normalizedInput.targetLangs,
    nativeLang: normalizedInput.nativeLang,
    topic: normalizedInput.topic,
    dictionaryContext: normalizedInput.dictionaryContext,
    outputConfig: normalizedInput.outputConfig,
    inputType: normalizedInput.inputType,
    negativeConstraints: normalizedInput.negativeConstraints,
  };

  getLogger().info(
    {
      original: input.word,
      sourceLang: input.sourceLang,
      targetLangs: input.targetLangs,
      topic: input.topic,
      model: input.model,
    },
    "translation request started",
  );

  const preliminaryRiskLevel = assessRiskLevel(normalizedInput, analysis.features, []);
  const generationModel = selectGenerationModel(normalizedInput, preliminaryRiskLevel);

  const requiresNativeOutput = normalizedInput.nativeLang !== undefined;
  const requiresSourceUsage =
    requiresNativeOutput &&
    normalizedInput.sourceLang !== normalizedInput.nativeLang &&
    normalizedInput.inputType !== "sentence";
  const requiresUsageNote =
    requiresNativeOutput &&
    normalizedInput.inputType !== "sentence" &&
    normalizedInput.outputConfig?.includeUsageNote !== false;
  const validationSchema = buildTranslationResultSchema(
    normalizedInput.targetLangs,
    normalizedInput.outputConfig,
    requiresNativeOutput,
    requiresSourceUsage,
    normalizedInput.nativeLang,
    requiresUsageNote,
    normalizedInput.sourceLang,
  );

  // Build parallel generation tasks: 1 metadata + N per-language calls
  const metadataSchema = buildMetadataSchema(
    normalizedInput.outputConfig,
    requiresNativeOutput,
    requiresSourceUsage,
    requiresNativeOutput,
  );

  const isLearningSource =
    normalizedInput.nativeLang !== undefined && normalizedInput.sourceLang !== normalizedInput.nativeLang;
  const languageTasks = normalizedInput.targetLangs.map((lang) => {
    const isMinimalNativeTarget = isLearningSource && lang === normalizedInput.nativeLang;
    return {
      lang,
      schema: buildLanguageTranslationSchema(
        normalizedInput.outputConfig,
        requiresNativeOutput && lang !== normalizedInput.nativeLang,
        requiresUsageNote,
        isMinimalNativeTarget,
      ),
    };
  });

  const generateOptions = {
    frequencyPenalty: 0,
    ...(normalizedInput.userId !== undefined ? { userId: normalizedInput.userId } : {}),
  };

  let metadataPrompt = buildMetadataPrompt(request);
  let languagePrompts = new Map(
    normalizedInput.targetLangs.map((lang) => [lang, buildSingleLanguagePrompt(request, lang)]),
  );
  let result: TranslationResult | undefined;
  let lastErrors: string[] = [];
  let attemptCount = 0;

  for (let attempt = 0; attempt <= MAX_FULL_RETRIES; attempt++) {
    try {
      attemptCount++;

      const [metadataResult, ...langResults] = await Promise.all([
        generateObjectFn(metadataPrompt, metadataSchema, generationModel, generateOptions),
        ...languageTasks.map((task) =>
          generateObjectFn(
            languagePrompts.get(task.lang) as string,
            task.schema as import("zod").ZodSchema<LanguageTranslation>,
            generationModel,
            generateOptions,
          ),
        ),
      ]);

      const translations: Record<string, LanguageTranslation> = {};
      for (let i = 0; i < languageTasks.length; i++) {
        translations[languageTasks[i].lang] = langResults[i] as LanguageTranslation;
      }

      result = {
        emoji: metadataResult.emoji,
        nativeMeaning: "nativeMeaning" in metadataResult ? (metadataResult.nativeMeaning as string) : undefined,
        sourceUsage:
          "sourceUsage" in metadataResult
            ? (metadataResult.sourceUsage as TranslationResult["sourceUsage"])
            : undefined,
        nativeSynonyms:
          "nativeSynonyms" in metadataResult
            ? (metadataResult.nativeSynonyms as TranslationResult["nativeSynonyms"])
            : [],
        translations,
      };
    } catch (generationError) {
      const errorMsg = generationError instanceof Error ? generationError.message : String(generationError);

      getLogger().warn(
        {
          original: input.word,
          retryCount: attempt,
          failReason: errorMsg,
        },
        "AI generation failed",
      );

      if (attempt === MAX_FULL_RETRIES) {
        throw generationError;
      }

      lastErrors = [`[generation] ${errorMsg}`];
      metadataPrompt = buildMetadataStrictPrompt(request, lastErrors);
      languagePrompts = new Map(
        normalizedInput.targetLangs.map((lang) => [lang, buildSingleLanguageStrictPrompt(request, lang, lastErrors)]),
      );
      continue;
    }

    const validation = validate(
      result,
      validationSchema,
      normalizedInput.word,
      normalizedInput.targetLangs,
      normalizedInput.inputType,
      {
        ...normalizedInput.outputConfig,
        nativeLang: normalizedInput.nativeLang,
        sourceLang: normalizedInput.sourceLang,
      },
    );

    lastErrors = validation.errors.map((e) => `[${e.rule}] ${e.field ? `${e.field}: ` : ""}${e.message}`);
    if (validation.valid || !validation.errors.some((error) => error.rule === "schema")) {
      break;
    }

    getLogger().warn(
      {
        original: input.word,
        retryCount: attempt,
        failReason: lastErrors.join(" | "),
      },
      "translation schema validation failed",
    );

    metadataPrompt = buildMetadataStrictPrompt(request, lastErrors);
    languagePrompts = new Map(
      normalizedInput.targetLangs.map((lang) => [lang, buildSingleLanguageStrictPrompt(request, lang, lastErrors)]),
    );
  }

  if (!result) {
    throw new Error("Translation generation produced no result");
  }

  let issues = collectQualityIssues(
    validate(result, validationSchema, normalizedInput.word, normalizedInput.targetLangs, normalizedInput.inputType, {
      ...normalizedInput.outputConfig,
      nativeLang: normalizedInput.nativeLang,
      sourceLang: normalizedInput.sourceLang,
    }),
  );

  if (hasBlockingIssues(issues)) {
    getLogger().warn(
      {
        original: normalizedInput.word,
        retryCount: 0,
        failReason: issues.map((issue) => issue.message).join(" | "),
      },
      "translation validation failed",
    );
    const repaired = await repairTranslationBlocks(
      result,
      issues,
      normalizedInput,
      request,
      generateObjectFn,
      attemptCount,
      generationModel,
    );
    result = repaired.result;
    issues = repaired.issues;
    attemptCount = repaired.attemptCount;
  }

  const riskLevel = assessRiskLevel(normalizedInput, analysis.features, issues);
  const routedGenerationModel =
    riskLevel === preliminaryRiskLevel ? generationModel : selectGenerationModel(normalizedInput, riskLevel);

  let judgeResult: SemanticJudgeResult | undefined;
  if (!hasBlockingIssues(issues) && riskLevel === "high") {
    const judged = await judgeTranslation(
      result,
      normalizedInput,
      request,
      generateObjectFn,
      attemptCount,
      routedGenerationModel,
    );
    judgeResult = judged.judgeResult;
    attemptCount = judged.attemptCount;

    if (judged.issues.length > 0) {
      issues = [...issues, ...judged.issues];
      if (hasBlockingIssues(judged.issues)) {
        const repaired = await repairTranslationBlocks(
          result,
          judged.issues,
          normalizedInput,
          request,
          generateObjectFn,
          attemptCount,
          routedGenerationModel,
        );
        result = repaired.result;
        attemptCount = repaired.attemptCount;
        issues = repaired.issues;

        if (!hasBlockingIssues(issues)) {
          const reJudged = await judgeTranslation(
            result,
            normalizedInput,
            request,
            generateObjectFn,
            attemptCount,
            routedGenerationModel,
          );
          judgeResult = reJudged.judgeResult;
          attemptCount = reJudged.attemptCount;
          issues = [...issues, ...reJudged.issues];
        }
      }
    }
  }

  if (!hasBlockingIssues(issues)) {
    return {
      status: "accepted",
      output: toOutput(normalizedInput, result),
      quality: {
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        riskLevel,
        modelId: routedGenerationModel,
        attemptCount,
        judgeResult,
        issues,
        detectionConfidence: normalizedInput.detectionConfidence,
      },
    };
  }

  getLogger().error(
    {
      original: normalizedInput.word,
      retryCount: Math.max(0, attemptCount - 1),
      failReason: issues.map((issue) => issue.message).join(" | "),
    },
    "translation validation failed after all retries — returning needs_review",
  );

  return {
    status: "needs_review",
    output: toOutput(normalizedInput, result),
    issues,
  };
}

/**
 * Re-translate a word for a single target language.
 *
 * Thin wrapper around translate() — calls it with targetLangs: [targetLang]
 * and extracts just the LanguageTranslation for that language.
 *
 * Used by partial regeneration — cheaper than full translate().
 *
 * @param input - Same as TranslateInput, plus a `targetLang` for the single language
 * @param generateObjectFn - AI generation function (injected)
 * @returns LanguageTranslation for the requested language
 */
export async function translateOne(
  input: TranslateInput & { targetLang: string },
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationDecision> {
  return translate(
    {
      word: input.word,
      sourceLang: input.sourceLang,
      targetLangs: [input.targetLang],
      nativeLang: input.nativeLang,
      model: input.model,
      topic: input.topic,
      userId: input.userId,
      dictionaryContext: input.dictionaryContext,
      outputConfig: input.outputConfig,
      inputType: input.inputType,
      detectionConfidence: input.detectionConfidence,
      modelRouting: input.modelRouting,
    },
    generateObjectFn,
  );
}

function collectQualityIssues(validation: ReturnType<typeof validate>): QualityIssue[] {
  return validation.errors.map((error) => ({
    fieldPath: error.field ?? "",
    severity: "blocking",
    message: `[${error.rule}] ${error.message}`,
    repairInstruction: buildRepairInstruction(error),
  }));
}

function buildRepairInstruction(error: { rule: string; message: string }): string | undefined {
  switch (error.rule) {
    case "immutable":
      return "Preserve placeholders, dates, URLs, Markdown, and numbers byte-for-byte in the translated text.";
    case "semantic":
      return "Keep the meaning intact and avoid repeating the original text verbatim unless the source is intentionally unchanged.";
    case "examples":
      return "Make each example use the assigned translation naturally and keep it aligned with the main translation.";
    case "language":
      return "Write the field in the required language/script and remove transliteration or copied target text.";
    case "duplication":
      return "Rewrite the note so it is specific to this target-language block.";
    default:
      return undefined;
  }
}

function hasBlockingIssues(issues: QualityIssue[]): boolean {
  return issues.some((issue) => issue.severity === "blocking");
}

function assessRiskLevel(
  input: TranslateInput,
  features: ReturnType<typeof analyzeInput>["features"],
  issues: QualityIssue[],
): RiskLevel {
  const score =
    scoreBlockingSignals(input, features, issues) +
    scoreDictionarySignals(input) +
    scoreLanguagePair(input) +
    scoreRichMetadata(input);

  if (score >= HIGH_RISK_SCORE) {
    return "high";
  }

  if (score >= MEDIUM_RISK_SCORE) {
    return "medium";
  }

  return "low";
}

function selectGenerationModel(input: TranslateInput, riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case "low":
      return input.modelRouting?.lowRiskModel ?? input.model;
    case "medium":
      return input.modelRouting?.mediumRiskModel ?? input.model;
    case "high":
      return input.modelRouting?.highRiskModel ?? input.model;
  }
}

function scoreBlockingSignals(
  input: TranslateInput,
  features: ReturnType<typeof analyzeInput>["features"],
  issues: QualityIssue[],
): number {
  let score = 0;

  if (issues.length > 0) score += HIGH_RISK_SCORE;
  if (input.inputType === "sentence") score += HIGH_RISK_SCORE;
  if (input.inputType === "phrase") score += HIGH_RISK_SCORE;
  if (features.hasPlaceholders) score += HIGH_RISK_SCORE;
  if (features.hasUrl) score += HIGH_RISK_SCORE;
  if (features.hasMarkdown) score += HIGH_RISK_SCORE;
  if (features.hasDates) score += HIGH_RISK_SCORE;
  if (features.hasCodeSwitching) score += HIGH_RISK_SCORE;
  if (input.detectionConfidence !== undefined && input.detectionConfidence < CONFIDENT_DETECTION_THRESHOLD) {
    score += HIGH_RISK_SCORE;
  }
  if (
    RISKY_CONTEXT_PATTERN.test(input.word) ||
    (input.topic !== undefined && RISKY_CONTEXT_PATTERN.test(input.topic))
  ) {
    score += HIGH_RISK_SCORE;
  }

  return score;
}

function scoreDictionarySignals(input: TranslateInput): number {
  if (input.dictionaryContext === undefined) {
    return input.inputType === "word" ? MEDIUM_RISK_SCORE : 0;
  }

  const pos = input.dictionaryContext.pos.toLowerCase();
  if (HIGH_RISK_POS.has(pos)) {
    return HIGH_RISK_SCORE;
  }

  if (input.dictionaryContext.glosses.length === 1) {
    return 0;
  }

  return input.dictionaryContext.glosses.length === 0 ? MEDIUM_RISK_SCORE : HIGH_RISK_SCORE;
}

function scoreLanguagePair(input: TranslateInput): number {
  const languages = [input.sourceLang, ...input.targetLangs];
  return languages.some((lang) => !COMMON_TRANSLATION_LANGS.has(lang)) ? HIGH_RISK_SCORE : 0;
}

function scoreRichMetadata(input: TranslateInput): number {
  if (input.inputType === "sentence") return 0;

  const config = input.outputConfig;
  const richMetadataRequested =
    input.nativeLang !== undefined ||
    config === undefined ||
    config.includeExamples !== false ||
    config.includeAlternatives !== false ||
    config.includeSynonyms !== false ||
    config.includeEquivalentNote !== false ||
    config.includeConnotationWarning !== false ||
    config.includeNativeSynonyms !== false;

  return richMetadataRequested ? MEDIUM_RISK_SCORE : 0;
}

function detectPreflightAmbiguity(
  input: TranslateInput,
  features: ReturnType<typeof analyzeInput>["features"],
): TranslationAmbiguity | undefined {
  if (input.topic?.trim()) {
    return undefined;
  }

  if (features.hasCodeSwitching) {
    return {
      reason: "mixed_or_transliterated_input",
      message:
        "The input mixes writing systems or transliteration, so the source meaning needs confirmation before translation.",
    };
  }

  const ambiguousDate = input.word.match(/\b(\d{1,2})([/.])(\d{1,2})(?:\2(\d{2,4}))?\b/);
  if (ambiguousDate) {
    const left = Number(ambiguousDate[1]);
    const right = Number(ambiguousDate[3]);
    if (left <= 12 && right <= 12) {
      return {
        reason: "date_or_time",
        message: `The date "${ambiguousDate[0]}" is ambiguous without locale context.`,
        options: [
          { label: `${ambiguousDate[1]}/${ambiguousDate[3]} (month/day)`, value: "month-day" },
          { label: `${ambiguousDate[3]}/${ambiguousDate[1]} (day/month)`, value: "day-month" },
        ],
      };
    }
  }

  return undefined;
}

function shouldRunAIPreflight(input: TranslateInput): input is TranslateInput & { detectionConfidence: number } {
  if (input.topic?.trim()) {
    return false;
  }
  if (input.inputType === "sentence") {
    return false;
  }
  return (
    input.detectionConfidence !== undefined && input.detectionConfidence < PREFLIGHT_DEFAULTS.autoProceedAboveConfidence
  );
}

function preflightOutcomeToReason(outcome: PreflightResult["outcome"]): TranslationAmbiguity["reason"] {
  switch (outcome) {
    case "clarify_source_language":
      return "source_language";
    case "clarify_meaning":
      return "word_sense";
    case "confirm_typo_suggestion":
      return "possible_typo";
    case "clarify_format":
      return "date_or_time";
    case "reject":
      return "unsupported_input";
    case "proceed":
      return "word_sense";
  }
}

async function detectAIPreflightAmbiguity(
  input: TranslateInput,
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationAmbiguity | undefined> {
  if (!shouldRunAIPreflight(input)) {
    return undefined;
  }

  const result = await generateObjectFn(
    buildPreflightPrompt({
      text: input.word,
      sourceLang: input.sourceLang,
      targetLangs: input.targetLangs,
      nativeLang: input.nativeLang,
      interfaceLang: input.interfaceLang,
      inputType: input.inputType ?? "word",
      detectionConfidence: input.detectionConfidence,
      config: PREFLIGHT_DEFAULTS,
    }),
    preflightResultSchema,
    input.model,
    {
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
    },
  );

  if (result.outcome === "proceed" && result.confidence >= PREFLIGHT_DEFAULTS.autoProceedAboveConfidence) {
    return undefined;
  }

  if (result.outcome === "clarify_meaning" && input.inputType === "word") {
    return undefined;
  }

  const reason =
    result.outcome === "proceed" && result.confidence < PREFLIGHT_DEFAULTS.clarifyBelowConfidence
      ? "word_sense"
      : preflightOutcomeToReason(result.outcome);

  return {
    reason,
    message: result.explanation,
    options: result.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      kind: option.kind,
      langCode: option.langCode,
      correctedText: option.correctedText,
    })),
  };
}

async function repairTranslationBlocks(
  result: TranslationResult,
  sourceIssues: QualityIssue[],
  input: TranslateInput,
  request: TranslationRequest,
  generateObjectFn: GenerateObjectFn,
  initialAttemptCount: number,
  fallbackGenerationModel: string,
): Promise<{ result: TranslationResult; issues: QualityIssue[]; attemptCount: number }> {
  const languages = uniqueRepairLanguages(sourceIssues);
  if (languages.length === 0) {
    return { result, issues: sourceIssues, attemptCount: initialAttemptCount };
  }

  let workingResult = result;
  let attemptCount = initialAttemptCount;
  const repairRiskLevel = assessRiskLevel(input, analyzeInput(input.word).features, sourceIssues);
  const repairModel =
    repairRiskLevel === "high" && input.modelRouting?.highRiskModel !== undefined
      ? input.modelRouting.highRiskModel
      : fallbackGenerationModel;

  for (const lang of languages) {
    const langIssues = sourceIssues.filter((issue) => issue.fieldPath.startsWith(`translations.${lang}.`));
    if (langIssues.length === 0) continue;

    for (let attempt = 0; attempt < MAX_TARGETED_REPAIRS; attempt++) {
      const repairedBlock = await generateObjectFn(
        buildRepairPrompt(request, lang, workingResult.translations[lang], langIssues),
        buildLanguageTranslationSchema(
          input.outputConfig,
          input.nativeLang !== undefined && lang !== input.nativeLang,
          input.nativeLang !== undefined &&
            input.inputType !== "sentence" &&
            input.outputConfig?.includeUsageNote !== false,
          input.nativeLang !== undefined && input.sourceLang !== input.nativeLang && lang === input.nativeLang,
        ) as import("zod").ZodSchema<LanguageTranslation>,
        repairModel,
        {
          frequencyPenalty: 0,
          ...(input.userId !== undefined ? { userId: input.userId } : {}),
        },
      );
      attemptCount++;
      const repairedTranslation = extractLanguageTranslation(repairedBlock, lang);

      workingResult = {
        ...workingResult,
        translations: {
          ...workingResult.translations,
          [lang]: repairedTranslation,
        },
      };

      const issues = collectQualityIssues(
        validate(
          workingResult,
          buildTranslationResultSchema(
            input.targetLangs,
            input.outputConfig,
            input.nativeLang !== undefined,
            input.nativeLang !== undefined && input.sourceLang !== input.nativeLang && input.inputType !== "sentence",
            input.nativeLang,
            input.nativeLang !== undefined &&
              input.inputType !== "sentence" &&
              input.outputConfig?.includeUsageNote !== false,
            input.sourceLang,
          ),
          input.word,
          input.targetLangs,
          input.inputType,
          {
            ...input.outputConfig,
            nativeLang: input.nativeLang,
            sourceLang: input.sourceLang,
          },
        ),
      );

      const remainingLangIssues = issues.filter((issue) => issue.fieldPath.startsWith(`translations.${lang}.`));
      if (!hasBlockingIssues(remainingLangIssues)) {
        sourceIssues = issues;
        break;
      }

      getLogger().warn(
        {
          original: input.word,
          retryCount: attempt + 1,
          failReason: remainingLangIssues.map((issue) => issue.message).join(" | "),
        },
        "translation validation failed",
      );

      sourceIssues = issues;
    }
  }

  return { result: workingResult, issues: sourceIssues, attemptCount };
}

function extractLanguageTranslation(value: unknown, lang: string): LanguageTranslation {
  if (typeof value === "object" && value !== null && "translations" in value) {
    const maybeResult = value as { translations?: Record<string, LanguageTranslation> };
    const translation = maybeResult.translations?.[lang];
    if (translation) {
      return translation;
    }
  }

  return value as LanguageTranslation;
}

function uniqueRepairLanguages(issues: QualityIssue[]): string[] {
  const languages = new Set<string>();
  for (const issue of issues) {
    const match = issue.fieldPath.match(/^translations\.([^.]+)\./);
    if (match) languages.add(match[1]);
  }
  return [...languages];
}

function buildRepairPrompt(
  request: TranslationRequest,
  targetLang: string,
  currentBlock: LanguageTranslation,
  issues: QualityIssue[],
): string {
  return `${buildTranslationPrompt({ ...request, targetLangs: [targetLang] })}

Targeted repair only for translations.${targetLang}.
Current block:
${JSON.stringify(currentBlock, null, 2)}

Fix only the reported issues:
${issues.map((issue) => `- ${issue.fieldPath}: ${issue.message}${issue.repairInstruction ? ` (${issue.repairInstruction})` : ""}`).join("\n")}

Preserve valid neighboring fields unless a reported issue requires changing them.
For sentence translations, the "text" field must contain only the translated sentence text: no emoji, commentary, labels, or metadata.
Return ONLY the corrected JSON object for the single target-language block schema.`;
}

async function judgeTranslation(
  result: TranslationResult,
  input: TranslateInput,
  request: TranslationRequest,
  generateObjectFn: GenerateObjectFn,
  initialAttemptCount: number,
  generationModel: string,
): Promise<{ judgeResult?: SemanticJudgeResult; issues: QualityIssue[]; attemptCount: number }> {
  try {
    const judgeModel = selectJudgeModel(generationModel, input.modelRouting?.judgeModel);
    const judgePrompt = buildJudgePrompt(request, result);
    const judgeResult = (await generateObjectFn(judgePrompt, semanticJudgeSchema, judgeModel, {
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
    })) as SemanticJudgeResult;

    return {
      judgeResult,
      issues: judgeResult.issues.map((issue) => ({
        ...issue,
        repairInstruction: issue.repairInstruction ?? undefined,
      })),
      attemptCount: initialAttemptCount + 1,
    };
  } catch (error) {
    getLogger().warn(
      {
        original: input.word,
        model: generationModel,
        judgeError: error instanceof Error ? error.message : String(error),
      },
      "semantic judge failed; continuing with deterministic validation only",
    );

    return { judgeResult: undefined, issues: [], attemptCount: initialAttemptCount };
  }
}

function selectJudgeModel(generatorModel: string, configuredJudgeModel?: string): string {
  if (configuredJudgeModel !== undefined) {
    return configuredJudgeModel;
  }

  if (generatorModel.startsWith("openai/")) {
    return "google/gemini-2.5-flash";
  }

  return "openai/gpt-4o-mini";
}

function buildJudgePrompt(request: TranslationRequest, result: TranslationResult): string {
  return `You are a translation quality judge.

Source text: ${JSON.stringify(request.text)}
Source language: ${request.sourceLang}
Target languages: ${request.targetLangs.join(", ")}
${request.nativeLang ? `Native language: ${request.nativeLang}` : ""}
${request.topic ? `Context hint: ${request.topic}` : ""}
${request.inputType ? `Input type: ${request.inputType}` : ""}

Candidate translation JSON:
${JSON.stringify(result, null, 2)}

Review each translation block and optional metadata.
Return blocking issues for:
- wrong main meaning, negation, entities, dates, numbers, or other factual content
- unsupported factual assumptions
- broken immutable tokens such as placeholders, URLs, Markdown, dates, and numbers
- target text polluted with emoji, labels, explanations, or metadata that were not in the source

Do NOT return blocking issues for acceptable stylistic variants, word-order differences, or valid polite constructions when the meaning, register, and facts are preserved.
If wording is merely less idiomatic but still correct, return a warning instead of blocking.

Return warnings for weaker auxiliary-field problems.
Each issue must use a concrete fieldPath such as "translations.cs.text" or "sourceUsage.explanation".
Return ONLY JSON matching the provided schema.`;
}

/**
 * Translate a batch of words into multiple target languages.
 *
 * Calls translate() for each word sequentially (not in parallel,
 * to avoid rate limiting issues with the AI provider).
 *
 * @param words - Array of words to translate
 * @param sourceLang - Source language code
 * @param targetLangs - Target language codes
 * @param model - AI model ID
 * @param generateObjectFn - AI generation function (injected)
 * @returns Array of TranslateOutput, one per word
 */
export async function translateBatch(
  words: string[],
  sourceLang: string,
  targetLangs: string[],
  model: string,
  generateObjectFn: GenerateObjectFn,
): Promise<TranslationDecision[]> {
  const results: TranslationDecision[] = [];

  for (const word of words) {
    const decision = await translate({ word, sourceLang, targetLangs, model }, generateObjectFn);
    results.push(decision);
  }

  return results;
}

/**
 * Parse and validate a raw AI response into TranslateOutput.
 *
 * Validates the raw data against translationResultSchema,
 * returns the parsed result or throws on invalid data.
 */
export function parseResponse(raw: unknown): TranslationResult {
  return translationResultSchema.parse(raw);
}

/**
 * Build the prompt for a translation request.
 *
 * Exposed for external testing/usage.
 */
export { buildTranslationPrompt as buildPrompt } from "./prompt.builder.js";

/** Default fallback emoji when AI returns a non-emoji string */
const DEFAULT_EMOJI = "🔤";

/**
 * Check whether a string looks like an emoji (not a plain-text word).
 *
 * The AI's typical failure mode is returning a synonym ("brittle", "fragile")
 * instead of an emoji. All such words contain ASCII letters, while real emoji
 * characters (including flags 🇷🇺, ZWJ sequences 👨‍👩‍👧, keycaps 1️⃣) do not.
 */
function looksLikeEmoji(value: string): boolean {
  return value.length > 0 && !/[a-zA-Z]/.test(value);
}

/** Ensure a value is a valid emoji, falling back to a default */
export function sanitizeEmoji(value: string): string {
  return looksLikeEmoji(value) ? value : DEFAULT_EMOJI;
}

function toOutput(input: TranslateInput, result: TranslationResult): TranslateOutput {
  const translations = stripDisabledFields(result.translations, input.outputConfig);

  const emoji = sanitizeEmoji(result.emoji);
  if (emoji !== result.emoji) {
    getLogger().warn(
      { original: input.word, rawEmoji: result.emoji, sanitized: emoji },
      "AI returned non-emoji string in emoji field, replaced with fallback",
    );
  }

  const output: TranslateOutput = {
    original: input.word,
    sourceLang: input.sourceLang,
    emoji,
    ...(input.nativeLang && result.nativeMeaning ? { nativeMeaning: result.nativeMeaning } : {}),
    ...(input.nativeLang && result.sourceUsage ? { sourceUsage: result.sourceUsage } : {}),
    nativeSynonyms: input.outputConfig?.includeNativeSynonyms === false ? [] : (result.nativeSynonyms ?? []),
    translations,
  };

  if (input.dictionaryContext) {
    output.dictionaryContext = input.dictionaryContext;
  }

  return output;
}

/**
 * Strip fields that were disabled via TranslationOutputConfig.
 *
 * The AI model may return optional fields even when not asked —
 * the Zod schema describes their structure (for `.default([])`),
 * and Vercel AI SDK exposes that to the model. This function
 * enforces the caller's intent by zeroing out disabled sections.
 */
function stripDisabledFields(
  translations: Record<string, LanguageTranslation>,
  config?: TranslationOutputConfig,
): Record<string, LanguageTranslation> {
  const stripped: Record<string, import("./types.js").LanguageTranslation> = {};

  for (const [lang, lt] of Object.entries(translations)) {
    stripped[lang] = {
      ...lt,
      synonyms: config?.includeSynonyms === false ? [] : (lt.synonyms ?? []),
      examples: config?.includeExamples === false ? [] : (lt.examples ?? []),
      alternatives: config?.includeAlternatives === false ? null : (lt.alternatives ?? null),
      expressionType: config?.includeEquivalentNote === false ? null : (lt.expressionType ?? null),
      equivalentNote: config?.includeEquivalentNote === false ? null : (lt.equivalentNote ?? null),
      usageNote: config?.includeUsageNote === false ? null : (lt.usageNote ?? null),
      connotationWarning: config?.includeConnotationWarning === false ? null : (lt.connotationWarning ?? null),
    };
  }

  return stripped;
}
