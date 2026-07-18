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
import type { GenerateObjectFn } from "../../ports/ai.port.js";
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
  InputCorrection,
  LanguageTranslation,
  QualityIssue,
  RiskLevel,
  TranslateInput,
  TranslateOutput,
  TranslationAmbiguity,
  TranslationDecision,
  TranslationModelRoutingPolicy,
  TranslationOutputConfig,
  TranslationRequest,
  TranslationResult,
} from "./types.js";

const MAX_FULL_RETRIES = 2;
const MAX_TARGETED_REPAIRS = 2;
/**
 * Repair budget on a clarify/confirm re-run. Pathologically ambiguous words
 * (e.g. "tow") can fight validation indefinitely; on a re-run the user is
 * waiting synchronously behind a Telegram callback, so cap the repairs and let
 * the pipeline settle to `needs_review` instead of burning the full budget.
 */
const MAX_TARGETED_REPAIRS_ON_RERUN = 1;
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
 * Translate a single word or phrase into multiple target languages.
 *
 * This is the main entry point for all translation operations.
 *
 * `translate()` is a THIN orchestrator (Fable T23/A12): it builds the initial
 * pipeline context and runs the ordered steps in {@link TRANSLATION_PIPELINE},
 * short-circuiting on the first step that produces a decision (an early exit
 * such as needs_clarification, or the final accepted / needs_review). Adding a
 * new phase is adding a step to the array and its function — never editing an
 * existing step body (open/closed).
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
  const ctx: PipelineContext = {
    rawInput: input,
    input: { ...input, inputType: input.inputType ?? analysis.type },
    analysis,
    unverified: false,
    issues: [],
    attemptCount: 0,
  };

  for (const step of TRANSLATION_PIPELINE) {
    const outcome = await step(ctx, generateObjectFn);
    if (outcome.kind === "exit") {
      return outcome.decision;
    }
  }

  // The final step (finalizeStep) always exits, so this is unreachable.
  throw new Error("Translation pipeline did not produce a decision");
}

// ─────────────────────────────────────────────
// Pipeline (Fable T23/A12)
//
// The translate() body is modeled as an explicit, ordered list of steps that
// thread a single mutable PipelineContext. Each step either `continue`s (having
// updated the context) or `exit`s with a TranslationDecision. This keeps the
// orchestrator thin and makes each phase (preflight → generate → validate/repair
// → judge → finalize) independently testable and extensible.
// ─────────────────────────────────────────────

/** Zod schema type for a full translation result. */
type TranslationResultSchema = ReturnType<typeof buildTranslationResultSchema>;

/**
 * State threaded through the translation pipeline steps. `rawInput`/`analysis`
 * are fixed at entry; `input` is the normalized (and possibly typo-corrected)
 * request; the remaining fields are populated by the step that owns them.
 */
interface PipelineContext {
  /** Original caller input — used for request-started/original logging. */
  readonly rawInput: TranslateInput;
  /** Normalized input (inputType filled; word replaced on silent correction). */
  input: TranslateInput;
  readonly analysis: ReturnType<typeof analyzeInput>;
  /** Silent minor-typo fix applied by the AI preflight, if any. */
  correction?: InputCorrection;
  /** Generation request derived from the normalized input. */
  request?: TranslationRequest;
  /** Deterministic validation schema, reused across validate/repair. */
  validationSchema?: TranslationResultSchema;
  /** Model chosen for generation from the preliminary risk assessment. */
  generationModel?: string;
  preliminaryRiskLevel?: RiskLevel;
  /** AI generation result once produced. */
  result?: TranslationResult;
  /** Task 70 source-word existence assessment, when requested. */
  sourceAssessment?: { recognized: boolean; correction: string | null };
  /** Task 70 — translated on override despite an unrecognized headword. */
  unverified: boolean;
  /** Accumulated quality issues from validation and the judge. */
  issues: QualityIssue[];
  /** Total generation/repair/judge attempts. */
  attemptCount: number;
  /** Post-repair risk level driving judge routing. */
  riskLevel?: RiskLevel;
  /** Generation model after risk re-routing. */
  routedGenerationModel?: string;
  judgeResult?: SemanticJudgeResult;
}

/** A step either continues (context updated in place) or exits with a decision. */
type StepOutcome = { kind: "continue" } | { kind: "exit"; decision: TranslationDecision };

type PipelineStep = (ctx: PipelineContext, generateObjectFn: GenerateObjectFn) => Promise<StepOutcome> | StepOutcome;

const CONTINUE: StepOutcome = { kind: "continue" };

/** The ordered translation pipeline. Add a phase by adding a step here. */
const TRANSLATION_PIPELINE: PipelineStep[] = [
  structuralPreflightStep,
  aiPreflightStep,
  generateStep,
  unrecognizedGuardStep,
  validateAndRepairStep,
  judgeStep,
  finalizeStep,
];

/**
 * Narrow the context to the fields the generation step guarantees. Throws if a
 * downstream step runs before generation populated them (a pipeline-ordering
 * invariant violation, not an expected runtime error).
 */
function requireGenerated(ctx: PipelineContext): {
  result: TranslationResult;
  request: TranslationRequest;
  validationSchema: TranslationResultSchema;
  generationModel: string;
  preliminaryRiskLevel: RiskLevel;
} {
  if (
    ctx.result === undefined ||
    ctx.request === undefined ||
    ctx.validationSchema === undefined ||
    ctx.generationModel === undefined ||
    ctx.preliminaryRiskLevel === undefined
  ) {
    throw new Error("Translation pipeline invariant violated: generation step did not populate the context");
  }
  return {
    result: ctx.result,
    request: ctx.request,
    validationSchema: ctx.validationSchema,
    generationModel: ctx.generationModel,
    preliminaryRiskLevel: ctx.preliminaryRiskLevel,
  };
}

/** Step 1 — structural preflight: detect locale/script ambiguity before any AI call. */
function structuralPreflightStep(ctx: PipelineContext): StepOutcome {
  const ambiguity = detectPreflightAmbiguity(ctx.input, ctx.analysis.features);
  if (ambiguity) {
    return { kind: "exit", decision: { status: "needs_clarification", ambiguity } };
  }
  return CONTINUE;
}

/** Step 2 — AI preflight: clarify source language / meaning / typo, or silently correct. */
async function aiPreflightStep(ctx: PipelineContext, generateObjectFn: GenerateObjectFn): Promise<StepOutcome> {
  const preflight = await runAIPreflight(ctx.input, generateObjectFn);
  if (preflight.kind === "clarify") {
    return { kind: "exit", decision: { status: "needs_clarification", ambiguity: preflight.ambiguity } };
  }

  // Silent minor-typo fix: translate the corrected text but remember the fix so
  // the reply can annotate it. `original` on the output becomes the corrected
  // form (that is what was translated and what the dictionary should store).
  if (preflight.kind === "correct") {
    ctx.correction = {
      original: ctx.input.word,
      corrected: preflight.correctedText,
      explanation: preflight.explanation,
    };
    ctx.input = { ...ctx.input, word: preflight.correctedText };
  }

  return CONTINUE;
}

/** Step 3 — generate: build request/schemas/prompts and run the retry loop. */
async function generateStep(ctx: PipelineContext, generateObjectFn: GenerateObjectFn): Promise<StepOutcome> {
  const normalizedInput = ctx.input;

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
  ctx.request = request;

  getLogger().info(
    {
      original: ctx.rawInput.word,
      sourceLang: ctx.rawInput.sourceLang,
      targetLangs: ctx.rawInput.targetLangs,
      topic: ctx.rawInput.topic,
      model: ctx.rawInput.model,
    },
    "translation request started",
  );

  const preliminaryRiskLevel = assessRiskLevel(normalizedInput, ctx.analysis.features, []);
  const generationModel = selectGenerationModel(normalizedInput, preliminaryRiskLevel);
  ctx.preliminaryRiskLevel = preliminaryRiskLevel;
  ctx.generationModel = generationModel;

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
  ctx.validationSchema = validationSchema;

  // Task 70 — assess the source headword's existence on the main call for
  // word/phrase inputs when the caller opts in. Defense-in-depth behind the
  // AI preflight; never runs for sentences or batch/topic/video flows.
  const assessExistence =
    normalizedInput.correctionPolicy?.assessSourceExistence === true && normalizedInput.inputType !== "sentence";

  // Build parallel generation tasks: 1 metadata + N per-language calls
  const metadataSchema = buildMetadataSchema(
    normalizedInput.outputConfig,
    requiresNativeOutput,
    requiresSourceUsage,
    requiresNativeOutput,
    assessExistence,
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

  let metadataPrompt = buildMetadataPrompt(request, assessExistence);
  let languagePrompts = new Map(
    normalizedInput.targetLangs.map((lang) => [lang, buildSingleLanguagePrompt(request, lang)]),
  );
  let result: TranslationResult | undefined;
  let sourceAssessment: { recognized: boolean; correction: string | null } | undefined;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_FULL_RETRIES; attempt++) {
    try {
      ctx.attemptCount++;

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

      if (assessExistence && "sourceWordRecognized" in metadataResult) {
        sourceAssessment = {
          recognized: metadataResult.sourceWordRecognized as boolean,
          correction: (metadataResult.suggestedCorrection as string | null) ?? null,
        };
      }
    } catch (generationError) {
      const errorMsg = generationError instanceof Error ? generationError.message : String(generationError);

      getLogger().warn(
        {
          original: ctx.rawInput.word,
          retryCount: attempt,
          failReason: errorMsg,
        },
        "AI generation failed",
      );

      if (attempt === MAX_FULL_RETRIES) {
        throw generationError;
      }

      lastErrors = [`[generation] ${errorMsg}`];
      metadataPrompt = buildMetadataStrictPrompt(request, lastErrors, assessExistence);
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
        original: ctx.rawInput.word,
        retryCount: attempt,
        failReason: lastErrors.join(" | "),
      },
      "translation schema validation failed",
    );

    metadataPrompt = buildMetadataStrictPrompt(request, lastErrors, assessExistence);
    languagePrompts = new Map(
      normalizedInput.targetLangs.map((lang) => [lang, buildSingleLanguageStrictPrompt(request, lang, lastErrors)]),
    );
  }

  if (!result) {
    throw new Error("Translation generation produced no result");
  }

  ctx.result = result;
  ctx.sourceAssessment = sourceAssessment;
  return CONTINUE;
}

/** Step 4 — Task 70 unrecognized-word guard: clarify, or flag the card unverified. */
function unrecognizedGuardStep(ctx: PipelineContext): StepOutcome {
  // When the source headword was assessed as not a real word and the user has
  // NOT already chosen to translate as written, stop and offer the correction /
  // "translate as written" instead of a confident fabricated card. On the
  // override re-run (skipInputCorrection), translate anyway but flag the result
  // unverified so the reply carries a caveat and the saved entry is excluded
  // from notifications/SRS suggestions.
  const { sourceAssessment } = ctx;
  if (sourceAssessment && !sourceAssessment.recognized) {
    if (ctx.input.correctionPolicy?.skipInputCorrection !== true) {
      return {
        kind: "exit",
        decision: {
          status: "needs_clarification",
          ambiguity: buildUnrecognizedAmbiguity(ctx.input, sourceAssessment.correction),
        },
      };
    }
    ctx.unverified = true;
  }
  return CONTINUE;
}

/** Step 5 — deterministic validation and targeted per-language repair. */
async function validateAndRepairStep(ctx: PipelineContext, generateObjectFn: GenerateObjectFn): Promise<StepOutcome> {
  const normalizedInput = ctx.input;
  const { result, request, validationSchema, generationModel, preliminaryRiskLevel } = requireGenerated(ctx);

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
      ctx.attemptCount,
      generationModel,
      isClarifyRerun(normalizedInput) ? MAX_TARGETED_REPAIRS_ON_RERUN : MAX_TARGETED_REPAIRS,
    );
    ctx.result = repaired.result;
    issues = repaired.issues;
    ctx.attemptCount = repaired.attemptCount;
  }

  ctx.issues = issues;
  const riskLevel = assessRiskLevel(normalizedInput, ctx.analysis.features, issues);
  ctx.riskLevel = riskLevel;
  ctx.routedGenerationModel =
    riskLevel === preliminaryRiskLevel ? generationModel : selectGenerationModel(normalizedInput, riskLevel);
  return CONTINUE;
}

/** Step 6 — high-risk semantic judge, with a single repair-and-re-judge cycle. */
async function judgeStep(ctx: PipelineContext, generateObjectFn: GenerateObjectFn): Promise<StepOutcome> {
  const normalizedInput = ctx.input;
  const { request, result: generatedResult } = requireGenerated(ctx);
  const routedGenerationModel = ctx.routedGenerationModel;
  if (routedGenerationModel === undefined || ctx.riskLevel === undefined) {
    throw new Error("Translation pipeline invariant violated: validate/repair step did not run before judge");
  }

  let result = generatedResult;
  let issues = ctx.issues;
  let attemptCount = ctx.attemptCount;

  if (!hasBlockingIssues(issues) && ctx.riskLevel === "high") {
    const judged = await judgeTranslation(
      result,
      normalizedInput,
      request,
      generateObjectFn,
      attemptCount,
      routedGenerationModel,
    );
    ctx.judgeResult = judged.judgeResult;
    attemptCount = judged.attemptCount;

    if (judged.issues.length > 0) {
      issues = [...issues, ...judged.issues];
      // On a clarify/confirm re-run, skip the extra repair-and-re-judge cycle:
      // the user is waiting behind a callback, so settle to needs_review instead.
      if (hasBlockingIssues(judged.issues) && !isClarifyRerun(normalizedInput)) {
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
          ctx.judgeResult = reJudged.judgeResult;
          attemptCount = reJudged.attemptCount;
          issues = [...issues, ...reJudged.issues];
        }
      }
    }
  }

  ctx.result = result;
  ctx.issues = issues;
  ctx.attemptCount = attemptCount;
  return CONTINUE;
}

/** Step 7 — finalize: accepted when no blocking issues remain, else needs_review. */
function finalizeStep(ctx: PipelineContext): StepOutcome {
  const normalizedInput = ctx.input;
  const { result } = requireGenerated(ctx);
  const { riskLevel, routedGenerationModel } = ctx;
  if (riskLevel === undefined || routedGenerationModel === undefined) {
    throw new Error("Translation pipeline invariant violated: validate/repair step did not run before finalize");
  }
  const { issues } = ctx;

  if (!hasBlockingIssues(issues)) {
    return {
      kind: "exit",
      decision: {
        status: "accepted",
        output: toOutput(normalizedInput, result, ctx.correction, ctx.unverified),
        quality: {
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          riskLevel,
          modelId: routedGenerationModel,
          attemptCount: ctx.attemptCount,
          judgeResult: ctx.judgeResult,
          issues,
          detectionConfidence: normalizedInput.detectionConfidence,
        },
      },
    };
  }

  getLogger().error(
    {
      original: normalizedInput.word,
      retryCount: Math.max(0, ctx.attemptCount - 1),
      failReason: issues.map((issue) => issue.message).join(" | "),
    },
    "translation validation failed after all retries — returning needs_review",
  );

  return {
    kind: "exit",
    decision: {
      status: "needs_review",
      output: toOutput(normalizedInput, result, ctx.correction, ctx.unverified),
      issues,
    },
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
      correctionPolicy: input.correctionPolicy,
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
    // Structured reason only — the channel localizes the prompt from `reason`
    // (Fable T23/A13). No core-authored UI string.
    return { reason: "mixed_or_transliterated_input" };
  }

  const ambiguousDate = input.word.match(/\b(\d{1,2})([/.])(\d{1,2})(?:\2(\d{2,4}))?\b/);
  if (ambiguousDate) {
    const left = Number(ambiguousDate[1]);
    const right = Number(ambiguousDate[3]);
    if (left <= 12 && right <= 12) {
      // Options carry the two concrete date interpretations as data (numerals);
      // the channel localizes the surrounding prompt from `reason`.
      return {
        reason: "date_or_time",
        params: { word: ambiguousDate[0] },
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
  if (input.detectionConfidence === undefined) {
    return false;
  }
  // Only low-confidence language detection triggers the preflight. Dictionary
  // presence is deliberately NOT a gate: the offline Wiktionary import is
  // incomplete, so a valid word's absence is not a typo signal (e.g. the common
  // verb "tow" is not in the table at all). Spelling/existence is instead judged
  // by the AI existence check (Task 70, `assessSourceExistence`).
  return input.detectionConfidence < PREFLIGHT_DEFAULTS.autoProceedAboveConfidence;
}

function preflightOutcomeToReason(outcome: PreflightResult["outcome"]): TranslationAmbiguity["reason"] {
  switch (outcome) {
    case "clarify_source_language":
      return "source_language";
    case "clarify_meaning":
      return "word_sense";
    case "confirm_typo_suggestion":
    case "proceed_with_correction":
      return "possible_typo";
    case "clarify_format":
      return "date_or_time";
    case "reject":
      return "unsupported_input";
    case "proceed":
      return "word_sense";
  }
}

/**
 * Result of the AI preflight pass.
 * - `proceed`: translate the input verbatim.
 * - `correct`: translate `correctedText` and annotate the reply with the fix.
 * - `clarify`: stop and ask the user (returned as `needs_clarification`).
 */
type PreflightDirective =
  | { kind: "proceed" }
  | { kind: "correct"; correctedText: string; explanation: string }
  | { kind: "clarify"; ambiguity: TranslationAmbiguity };

async function runAIPreflight(input: TranslateInput, generateObjectFn: GenerateObjectFn): Promise<PreflightDirective> {
  if (!shouldRunAIPreflight(input)) {
    return { kind: "proceed" };
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
    return { kind: "proceed" };
  }

  // Silent minor-typo fix (Task 69). Suppressed on verbatim re-runs, and a
  // no-op "correction" (same text, or a missing corrected form) proceeds as-is.
  if (result.outcome === "proceed_with_correction") {
    if (input.correctionPolicy?.skipInputCorrection || !result.correctedText || result.correctedText === input.word) {
      return { kind: "proceed" };
    }
    return { kind: "correct", correctedText: result.correctedText, explanation: result.explanation };
  }

  // After the language/mistype confirmation, or on "translate as written",
  // never re-ask about the same word — translate it verbatim.
  if (result.outcome === "confirm_typo_suggestion" && input.correctionPolicy?.skipInputCorrection) {
    return { kind: "proceed" };
  }

  if (result.outcome === "clarify_meaning" && input.inputType === "word") {
    return { kind: "proceed" };
  }

  const reason =
    result.outcome === "proceed" && result.confidence < PREFLIGHT_DEFAULTS.clarifyBelowConfidence
      ? "word_sense"
      : preflightOutcomeToReason(result.outcome);

  return {
    kind: "clarify",
    ambiguity: {
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
    },
  };
}

/**
 * A clarify/confirm re-run: the user already engaged (confirmed the language or
 * a typo, or supplied a context hint), so the input is translated a second time.
 * These re-runs are latency-critical — the user waits synchronously behind a
 * Telegram callback — so they get a reduced repair budget and skip the extra
 * judge repair-and-re-judge cycle, settling to `needs_review` instead of
 * burning the full budget on a pathologically ambiguous word.
 *
 * Gated on `skipInputCorrection` alone: every re-run path sets it (the
 * mistype/language-confirm callbacks and the post-translation clarify flow).
 * `topic` is deliberately NOT a signal — it is also present on a genuine
 * first-pass translation carrying an inline context hint (`word :: context`),
 * which must keep the full repair/judge budget.
 */
function isClarifyRerun(input: TranslateInput): boolean {
  return input.correctionPolicy?.skipInputCorrection === true;
}

async function repairTranslationBlocks(
  result: TranslationResult,
  sourceIssues: QualityIssue[],
  input: TranslateInput,
  request: TranslationRequest,
  generateObjectFn: GenerateObjectFn,
  initialAttemptCount: number,
  fallbackGenerationModel: string,
  maxTargetedRepairs: number = MAX_TARGETED_REPAIRS,
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

    for (let attempt = 0; attempt < maxTargetedRepairs; attempt++) {
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
    const judgeModel = selectJudgeModel(generationModel, input.modelRouting);
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

/**
 * Chooses the semantic-judge model. A judge from a different provider family
 * than the generator avoids a model grading its own house style, but the
 * concrete model ids must come from configuration (DB-backed `SettingsPort` via
 * `modelRouting`), never hardcoded in core (Fable T21/A2 — "model lives in the
 * DB"). Resolution order:
 *   1. an explicitly configured `judgeModel`;
 *   2. otherwise a configured risk model from a *different* family than the
 *      generator (the "judge ≠ generator family" rule, applied to config values);
 *   3. otherwise the generator model itself — a safe last resort with no baked-in
 *      model id. Configure `judgeModel` to get cross-family judging.
 */
function selectJudgeModel(generatorModel: string, routing?: TranslationModelRoutingPolicy): string {
  if (routing?.judgeModel !== undefined) {
    return routing.judgeModel;
  }

  const generatorFamily = modelFamily(generatorModel);
  const differentFamily = [routing?.highRiskModel, routing?.mediumRiskModel, routing?.lowRiskModel]
    .filter((m): m is string => typeof m === "string")
    .find((m) => modelFamily(m) !== generatorFamily);

  return differentFamily ?? generatorModel;
}

/** Provider family of a model id, e.g. "openai" from "openai/gpt-4o". */
function modelFamily(model: string): string {
  return model.split("/")[0] ?? model;
}

export function buildJudgePrompt(request: TranslationRequest, result: TranslationResult): string {
  return `You are a translation quality judge.

Source text: ${JSON.stringify(request.text)}
Source language: ${request.sourceLang}
Target languages: ${request.targetLangs.join(", ")}
${request.nativeLang ? `Native language: ${request.nativeLang}` : ""}
${request.topic ? `Context hint: ${request.topic}` : ""}
${request.inputType ? `Input type: ${request.inputType}` : ""}

Candidate translation JSON:
${JSON.stringify(result, null, 2)}

The candidate JSON follows a fixed output schema. The following structured fields are REQUIRED and intentional — never flag them as pollution, "extra metadata", "unexpected fields", or "not present in the source":
- top level: "emoji", "nativeMeaning", "sourceUsage" (with "headword", "explanation", "synonyms", "examples"), "nativeSynonyms"
- inside each "translations".<lang> block: "text", "synonyms", "examples", "expressionType", "equivalentNote", "usageNote", "alternatives", "connotationWarning"
Judge only the linguistic quality of these values, never the presence of the fields themselves.

Return blocking issues only for:
- wrong main meaning, negation, entities, dates, numbers, or other factual content in a "translations".<lang>."text" value
- unsupported factual assumptions
- broken immutable tokens such as placeholders, URLs, Markdown, dates, and numbers inside a "translations".<lang>."text" value
- a "translations".<lang>."text" string that is itself polluted with emoji, bracketed labels, or inline explanations that were not in the source sentence — this pollution rule applies ONLY to the translated "text" string, never to the structured schema fields listed above

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

/**
 * Build the "unrecognized word" clarification (Task 70).
 *
 * Offers any confident correction as a typo_correction option plus an explicit
 * "translate as written" escape hatch. Returns a STRUCTURED reason + params
 * (`word`, source `lang` code) rather than a localized message: the channel
 * renders the text via its own `t()` (Fable T23/A13 — core returns no UI
 * strings). The correction option's label is the corrected word itself (data,
 * not a UI string); the "translate as written" option carries no label so the
 * channel localizes it from `kind`.
 */
function buildUnrecognizedAmbiguity(input: TranslateInput, correction: string | null): TranslationAmbiguity {
  const options: TranslationAmbiguity["options"] = [];

  if (correction?.trim() && correction !== input.word) {
    options.push({
      kind: "typo_correction",
      label: correction,
      value: correction,
      correctedText: correction,
    });
  }

  options.push({
    kind: "translate_as_written",
    value: "as_written",
  });

  return {
    reason: "unrecognized_word",
    params: { word: input.word, lang: input.sourceLang },
    options,
  };
}

function toOutput(
  input: TranslateInput,
  result: TranslationResult,
  correction?: InputCorrection,
  unverified = false,
): TranslateOutput {
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

  if (correction) {
    output.correction = correction;
  }

  if (unverified) {
    output.unverified = true;
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
