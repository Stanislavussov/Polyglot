import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AIRequestLog } from "@polyglot/adapter-ai";
import type {
  DetectionEvidence,
  DetectionResult,
  GenerateObjectFn,
  TranslateInput,
  TranslationDecision,
} from "@polyglot/core";
import { translate } from "@polyglot/core";
import type { ZodSchema } from "zod";

export type QualityDimension =
  | "primaryTranslation"
  | "auxiliaryFields"
  | "factualPreservation"
  | "naturalnessRegister"
  | "ambiguityHandling";

export interface TranslationBenchmarkCase {
  fixtureVersion: 1;
  id: string;
  category: string;
  description: string;
  expectedMeaning: string;
  qualityRisks: string[];
  assertions: TranslationQualityAssertions;
  input: Omit<TranslateInput, "model" | "userId">;
}

export interface TranslationQualityAssertions {
  expectedAction: "translate" | "needs_clarification";
  immutableTokens?: string[];
  requiredSubstrings?: Partial<Record<string, string[]>>;
  forbiddenSubstrings?: Partial<Record<string, string[]>>;
  requiredRegisterSubstrings?: Partial<Record<string, string[]>>;
  forbiddenRegisterSubstrings?: Partial<Record<string, string[]>>;
  requiredMetadata?: Array<"nativeMeaning" | "sourceUsage">;
  expectedSimplePath?: boolean;
}

export interface DetectionBenchmarkCase {
  id: string;
  category:
    | "ambiguous-homograph"
    | "candidate-order"
    | "close-languages"
    | "code-switching"
    | "context-disambiguation"
    | "name-or-brand"
    | "noise-or-transliteration";
  text: string;
  candidates: string[];
  expectedSourceLang?: string;
  expectedAction: "translate" | "ask_source_language";
  explanation: string;
}

export interface BenchmarkRequestMetric {
  model: string;
  // Mirrors the adapter rather than re-declaring the union, so a new request kind
  // (e.g. "speech") cannot silently break this report.
  requestKind: AIRequestLog["requestKind"];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
}

interface BenchmarkAttempt {
  attempt: number;
  model: string;
  prompt: string;
  response?: unknown;
  error?: string;
}

export interface QualityCheck {
  dimension: QualityDimension;
  passed: boolean;
  message?: string;
}

interface CompletedBenchmarkCase {
  case: TranslationBenchmarkCase;
  run: number;
  status: "completed";
  qualityPassed: boolean;
  qualityIssues: string[];
  qualityChecks: QualityCheck[];
  durationMs: number;
  requestMetrics: BenchmarkRequestMetric[];
  attempts: BenchmarkAttempt[];
  decision: TranslationDecision;
}

interface FailedBenchmarkCase {
  case: TranslationBenchmarkCase;
  run: number;
  status: "failed";
  durationMs: number;
  requestMetrics: BenchmarkRequestMetric[];
  attempts: BenchmarkAttempt[];
  error: string;
}

export type BenchmarkCaseResult = CompletedBenchmarkCase | FailedBenchmarkCase;

export interface DetectionBenchmarkResult {
  case: DetectionBenchmarkCase;
  run: number;
  observedSourceLang?: string;
  confidence: number;
  evidence?: DetectionEvidence[];
  ambiguousCandidates?: string[];
  matchesExpectation: boolean;
  durationMs: number;
  requestMetrics: BenchmarkRequestMetric[];
  error?: string;
}

interface MetricScore {
  passed: number;
  total: number;
  rate: number;
}

export interface LanguagePairScore extends MetricScore {
  pair: string;
}

export interface BenchmarkRegression {
  pair: string;
  baselineRate: number;
  currentRate: number;
  zScore: number;
  significant: boolean;
}

export interface ReleaseGate {
  id:
    | "immutable-preservation"
    | "ambiguity-handling"
    | "primary-translation"
    | "auxiliary-fields"
    | "language-pair-regression"
    | "simple-path";
  passed: boolean;
  actual: string;
  required: string;
}

export interface TranslationBenchmarkReport {
  schemaVersion: 4;
  fixtureVersion: 1;
  promptVersion: string;
  generatedAt: string;
  model: string;
  runsPerCase: number;
  modelSettings: {
    temperature: number;
    frequencyPenalty: number;
    providerMaxRetries: number;
  };
  summary: {
    cases: number;
    executions: number;
    completed: number;
    failed: number;
    qualityPassed: number;
    qualityFailed: number;
    passRate: number;
    latencyMs: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  dimensionScores: Record<QualityDimension | "detectionAccuracy" | "repairSuccess", MetricScore>;
  languagePairScores: LanguagePairScore[];
  regressions: BenchmarkRegression[];
  releaseGates: ReleaseGate[];
  detectionSummary: {
    total: number;
    matched: number;
    mismatched: number;
  };
  detectionResults: DetectionBenchmarkResult[];
  results: BenchmarkCaseResult[];
}

interface RunTranslationBenchmarkOptions {
  model: string;
  outputPath: string;
  jsonOutputPath?: string;
  baseline?: TranslationBenchmarkReport;
  runsPerCase?: number;
  generateObjectFn: GenerateObjectFn;
  cases: TranslationBenchmarkCase[];
  detectionCases: DetectionBenchmarkCase[];
  detectLanguageFn: (text: string, candidates: string[]) => Promise<DetectionResult>;
  consumeRequestMetrics?: () => BenchmarkRequestMetric[];
}

const PROMPT_VERSION = "translation-v1";
const MODEL_SETTINGS = {
  temperature: 0.3,
  frequencyPenalty: 0,
  providerMaxRetries: 2,
} as const;
const QUALITY_DIMENSIONS: QualityDimension[] = [
  "primaryTranslation",
  "auxiliaryFields",
  "factualPreservation",
  "naturalnessRegister",
  "ambiguityHandling",
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tableCell(value: string | undefined): string {
  return (value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function rate(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sumMetrics(metrics: BenchmarkRequestMetric[]): {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
} {
  return metrics.reduce(
    (total, metric) => ({
      costUsd: total.costUsd + metric.costUsd,
      inputTokens: total.inputTokens + metric.inputTokens,
      outputTokens: total.outputTokens + metric.outputTokens,
    }),
    { costUsd: 0, inputTokens: 0, outputTokens: 0 },
  );
}

export function renderBenchmarkReportMarkdown(report: TranslationBenchmarkReport): string {
  const lines = [
    "# Translation benchmark report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Model: \`${report.model}\``,
    `- Runs per stochastic case: ${report.runsPerCase}`,
    `- Prompt version: \`${report.promptVersion}\``,
    `- Fixture/report schema versions: \`${report.fixtureVersion}\` / \`${report.schemaVersion}\``,
    `- Model settings: temperature=${report.modelSettings.temperature}, frequencyPenalty=${report.modelSettings.frequencyPenalty}, providerMaxRetries=${report.modelSettings.providerMaxRetries}`,
    `- Executions: ${report.summary.completed}/${report.summary.executions} completed, ${report.summary.failed} failed`,
    `- Quality pass rate: ${report.summary.qualityPassed}/${report.summary.executions} (${percentage(report.summary.passRate)})`,
    `- Detection: ${report.detectionSummary.matched}/${report.detectionSummary.total} matched`,
    `- Total latency/cost: ${report.summary.latencyMs} ms / $${report.summary.costUsd.toFixed(6)}`,
    `- Tokens: ${report.summary.inputTokens} input / ${report.summary.outputTokens} output`,
    "",
    "## Quality dimensions",
    "",
    "| Dimension | Passed | Total | Rate |",
    "|---|---:|---:|---:|",
    ...Object.entries(report.dimensionScores).map(
      ([dimension, score]) => `| ${dimension} | ${score.passed} | ${score.total} | ${percentage(score.rate)} |`,
    ),
    "",
    "## Release gates",
    "",
    "| Gate | Actual | Required | Result |",
    "|---|---:|---:|---|",
    ...report.releaseGates.map(
      (gate) => `| ${gate.id} | ${gate.actual} | ${gate.required} | ${gate.passed ? "PASS" : "FAIL"} |`,
    ),
    "",
    "## Language pairs",
    "",
    "| Pair | Passed | Total | Rate | Regression |",
    "|---|---:|---:|---:|---|",
    ...report.languagePairScores.map((score) => {
      const regression = report.regressions.find((item) => item.pair === score.pair);
      const regressionText = regression
        ? `${regression.significant ? "SIGNIFICANT" : "not significant"} (z=${regression.zScore.toFixed(2)})`
        : "—";
      return `| ${score.pair} | ${score.passed} | ${score.total} | ${percentage(score.rate)} | ${regressionText} |`;
    }),
    "",
    "## Source-language detection",
    "",
    "| Case | Input | Expected | Observed | Result |",
    "|---|---|---|---|---|",
    ...report.detectionResults.map((result) => {
      const expected =
        result.case.expectedAction === "ask_source_language" ? "ask_source_language" : result.case.expectedSourceLang;
      return `| ${tableCell(`${result.case.id} (run ${result.run})`)} | ${tableCell(result.case.text)} | ${tableCell(expected)} | ${tableCell(result.observedSourceLang)} | ${result.matchesExpectation ? "PASS" : "FAIL"} |`;
    }),
    "",
    "## Translation results",
    "",
  ];

  for (const result of report.results) {
    lines.push(
      `### ${result.case.id} — run ${result.run}`,
      "",
      `- Category: ${result.case.category}`,
      `- Input: ${result.case.input.word}`,
      `- Source: ${result.case.input.sourceLang}`,
      `- Targets: ${result.case.input.targetLangs.join(", ")}`,
      `- Expected meaning: ${result.case.expectedMeaning}`,
      `- Status: ${result.status}`,
      `- Duration: ${result.durationMs} ms`,
      `- Request metrics: ${result.requestMetrics.length} requests, $${sumMetrics(result.requestMetrics).costUsd.toFixed(6)}`,
      "",
    );

    if (result.status === "completed") {
      lines.push(
        `- Quality assertions: ${result.qualityPassed ? "PASS" : "FAIL"}`,
        ...(result.qualityIssues.length > 0
          ? ["- Quality issues:", ...result.qualityIssues.map((issue) => `  - ${issue}`)]
          : []),
        "",
        "```json",
        JSON.stringify(result.decision, null, 2),
        "```",
        "",
      );
    } else {
      lines.push(`Error: ${result.error}`, "");
    }

    lines.push("#### Raw attempts", "");
    for (const attempt of result.attempts) {
      lines.push(
        `Attempt ${attempt.attempt} (${attempt.model}):`,
        "",
        "```text",
        attempt.prompt,
        "```",
        "",
        "```json",
        JSON.stringify(attempt.response ?? { error: attempt.error }, null, 2),
        "```",
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function countOccurrences(value: string, token: string): number {
  if (token.length === 0) return 0;

  let count = 0;
  let offset = 0;
  while (offset <= value.length - token.length) {
    const index = value.indexOf(token, offset);
    if (index === -1) break;
    count++;
    offset = index + token.length;
  }
  return count;
}

function failedCheck(dimension: QualityDimension, message: string): QualityCheck {
  return { dimension, passed: false, message };
}

function issueDimension(fieldPath: string, message: string): QualityDimension {
  const normalized = `${fieldPath} ${message}`.toLocaleLowerCase();
  if (/natural|register|intens|formal|polite|tone/.test(normalized)) return "naturalnessRegister";
  if (/placeholder|url|markdown|date|time|number|fact|assumption|hallucin/.test(normalized)) {
    return "factualPreservation";
  }
  if (/example|synonym|alternative|usage|meaning|metadata|transcription/.test(normalized)) {
    return "auxiliaryFields";
  }
  return "primaryTranslation";
}

export function evaluateTranslationQualityChecks(
  benchmarkCase: TranslationBenchmarkCase,
  decision: TranslationDecision,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const assertions = benchmarkCase.assertions;
  const expectedClarification = assertions.expectedAction === "needs_clarification";
  const clarificationPassed = decision.status === "needs_clarification" && expectedClarification;

  checks.push(
    clarificationPassed || (!expectedClarification && decision.status !== "needs_clarification")
      ? { dimension: "ambiguityHandling", passed: true }
      : failedCheck(
          "ambiguityHandling",
          expectedClarification
            ? `Expected needs_clarification, but the pipeline returned status="${decision.status}"`
            : "Pipeline returned needs_clarification, but the case expects a translation",
        ),
  );

  if (decision.status === "needs_clarification") {
    return checks;
  }

  if (decision.status === "needs_review") {
    checks.push(failedCheck("primaryTranslation", "Pipeline returned needs_review — validation failed after retries"));
  }

  const pipelineIssues = decision.status === "accepted" ? decision.quality.issues : decision.issues;
  for (const issue of pipelineIssues) {
    // Advisory issues are non-blocking by design (they never forced needs_review),
    // so — like info — they must not count as a benchmark quality failure.
    if (issue.severity !== "info" && issue.severity !== "advisory") {
      checks.push(
        failedCheck(
          issueDimension(issue.fieldPath, issue.message),
          `${issue.fieldPath}: ${issue.message} (${issue.severity})`,
        ),
      );
    }
  }

  const result = decision.output;
  for (const [lang, translation] of Object.entries(result.translations)) {
    const source = benchmarkCase.input.word;
    for (const token of assertions.immutableTokens ?? []) {
      const expectedCount = countOccurrences(source, token);
      const actualCount = countOccurrences(translation.text, token);
      checks.push(
        actualCount === expectedCount
          ? { dimension: "factualPreservation", passed: true }
          : failedCheck(
              "factualPreservation",
              `translations.${lang}.text must preserve "${token}" byte-for-byte (${expectedCount} expected, ${actualCount} found)`,
            ),
      );
    }

    const normalizedText = translation.text.toLocaleLowerCase();
    for (const required of assertions.requiredSubstrings?.[lang] ?? []) {
      checks.push(
        normalizedText.includes(required.toLocaleLowerCase())
          ? { dimension: "primaryTranslation", passed: true }
          : failedCheck("primaryTranslation", `translations.${lang}.text is missing required text "${required}"`),
      );
    }
    for (const forbidden of assertions.forbiddenSubstrings?.[lang] ?? []) {
      checks.push(
        !normalizedText.includes(forbidden.toLocaleLowerCase())
          ? { dimension: "primaryTranslation", passed: true }
          : failedCheck("primaryTranslation", `translations.${lang}.text contains forbidden text "${forbidden}"`),
      );
    }
    for (const required of assertions.requiredRegisterSubstrings?.[lang] ?? []) {
      checks.push(
        normalizedText.includes(required.toLocaleLowerCase())
          ? { dimension: "naturalnessRegister", passed: true }
          : failedCheck("naturalnessRegister", `translations.${lang}.text is missing register marker "${required}"`),
      );
    }
    for (const forbidden of assertions.forbiddenRegisterSubstrings?.[lang] ?? []) {
      checks.push(
        !normalizedText.includes(forbidden.toLocaleLowerCase())
          ? { dimension: "naturalnessRegister", passed: true }
          : failedCheck("naturalnessRegister", `translations.${lang}.text contains forbidden register "${forbidden}"`),
      );
    }
  }

  for (const field of assertions.requiredMetadata ?? []) {
    checks.push(
      result[field] === undefined
        ? failedCheck("auxiliaryFields", `${field} metadata is required`)
        : { dimension: "auxiliaryFields", passed: true },
    );
  }

  if (assertions.expectedSimplePath) {
    const simplePathPassed =
      decision.status === "accepted" &&
      decision.quality.judgeResult === undefined &&
      decision.quality.attemptCount === 1;
    checks.push(
      simplePathPassed
        ? { dimension: "auxiliaryFields", passed: true }
        : failedCheck("auxiliaryFields", "Simple path must use one generation attempt without semantic judge"),
    );
  }

  for (const dimension of QUALITY_DIMENSIONS) {
    if (!checks.some((check) => check.dimension === dimension)) {
      checks.push({ dimension, passed: true });
    }
  }

  return checks;
}

export function evaluateTranslationQuality(
  benchmarkCase: TranslationBenchmarkCase,
  decision: TranslationDecision,
): string[] {
  return evaluateTranslationQualityChecks(benchmarkCase, decision).flatMap((check) =>
    check.passed || check.message === undefined ? [] : [check.message],
  );
}

async function runCase(
  benchmarkCase: TranslationBenchmarkCase,
  run: number,
  model: string,
  generateObjectFn: GenerateObjectFn,
  consumeRequestMetrics?: () => BenchmarkRequestMetric[],
): Promise<BenchmarkCaseResult> {
  consumeRequestMetrics?.();
  const attempts: BenchmarkAttempt[] = [];
  const trackedGenerateObject: GenerateObjectFn = async <T>(
    prompt: string,
    schema: ZodSchema<T>,
    requestedModel: string,
    options?: { userId?: number; frequencyPenalty?: number },
  ): Promise<T> => {
    const attempt: BenchmarkAttempt = {
      attempt: attempts.length + 1,
      model: requestedModel,
      prompt,
    };
    attempts.push(attempt);

    try {
      const response = await generateObjectFn(prompt, schema, requestedModel, options);
      attempt.response = response;
      return response;
    } catch (error) {
      attempt.error = errorMessage(error);
      throw error;
    }
  };

  const startedAt = Date.now();

  try {
    const decision = await translate({ ...benchmarkCase.input, model }, trackedGenerateObject);
    const qualityChecks = evaluateTranslationQualityChecks(benchmarkCase, decision);
    const qualityIssues = qualityChecks.flatMap((check) =>
      check.passed || check.message === undefined ? [] : [check.message],
    );
    return {
      case: benchmarkCase,
      run,
      status: "completed",
      qualityPassed: qualityIssues.length === 0,
      qualityIssues,
      qualityChecks,
      durationMs: Date.now() - startedAt,
      requestMetrics: consumeRequestMetrics?.() ?? [],
      attempts,
      decision,
    };
  } catch (error) {
    return {
      case: benchmarkCase,
      run,
      status: "failed",
      durationMs: Date.now() - startedAt,
      requestMetrics: consumeRequestMetrics?.() ?? [],
      attempts,
      error: errorMessage(error),
    };
  }
}

async function runDetectionCase(
  benchmarkCase: DetectionBenchmarkCase,
  run: number,
  detectLanguageFn: RunTranslationBenchmarkOptions["detectLanguageFn"],
  consumeRequestMetrics?: () => BenchmarkRequestMetric[],
): Promise<DetectionBenchmarkResult> {
  consumeRequestMetrics?.();
  const startedAt = Date.now();

  try {
    const detection = await detectLanguageFn(benchmarkCase.text, benchmarkCase.candidates);
    const observedSourceLang = detection.language;
    return {
      case: benchmarkCase,
      run,
      ...(observedSourceLang !== undefined ? { observedSourceLang } : {}),
      confidence: detection.confidence,
      ...(detection.evidence.length > 0 ? { evidence: detection.evidence } : {}),
      ...(detection.ambiguousCandidates ? { ambiguousCandidates: detection.ambiguousCandidates } : {}),
      matchesExpectation: observedSourceLang === benchmarkCase.expectedSourceLang,
      durationMs: Date.now() - startedAt,
      requestMetrics: consumeRequestMetrics?.() ?? [],
    };
  } catch (error) {
    return {
      case: benchmarkCase,
      run,
      confidence: 0,
      matchesExpectation: false,
      durationMs: Date.now() - startedAt,
      requestMetrics: consumeRequestMetrics?.() ?? [],
      error: errorMessage(error),
    };
  }
}

function scoreDimension(results: BenchmarkCaseResult[], dimension: QualityDimension): MetricScore {
  const completed = results.filter((result): result is CompletedBenchmarkCase => result.status === "completed");
  const applicable = completed.map((result) => ({
    passed: result.qualityChecks.filter((check) => check.dimension === dimension).every((check) => check.passed),
  }));
  const passed = applicable.filter((item) => item.passed).length;
  return { passed, total: applicable.length, rate: rate(passed, applicable.length) };
}

function scoreRepairSuccess(results: BenchmarkCaseResult[]): MetricScore {
  const repaired = results.filter(
    (result): result is CompletedBenchmarkCase =>
      result.status === "completed" &&
      result.decision.status === "accepted" &&
      result.decision.quality.attemptCount > 1,
  );
  const passed = repaired.filter((result) => result.decision.status === "accepted" && result.qualityPassed).length;
  return { passed, total: repaired.length, rate: rate(passed, repaired.length) };
}

function languagePairScores(results: BenchmarkCaseResult[]): LanguagePairScore[] {
  const pairs = new Map<string, { passed: number; total: number }>();
  for (const result of results) {
    for (const target of result.case.input.targetLangs) {
      const pair = `${result.case.input.sourceLang}->${target}`;
      const current = pairs.get(pair) ?? { passed: 0, total: 0 };
      current.total++;
      if (result.status === "completed" && result.qualityPassed) current.passed++;
      pairs.set(pair, current);
    }
  }
  return [...pairs.entries()]
    .map(([pair, score]) => ({ pair, ...score, rate: rate(score.passed, score.total) }))
    .sort((left, right) => left.pair.localeCompare(right.pair));
}

export function compareLanguagePairScores(
  current: LanguagePairScore[],
  baseline: LanguagePairScore[],
): BenchmarkRegression[] {
  const baselineByPair = new Map(baseline.map((score) => [score.pair, score]));
  return current.flatMap((score) => {
    const previous = baselineByPair.get(score.pair);
    if (!previous || score.total === 0 || previous.total === 0) return [];

    const pooledRate = (score.passed + previous.passed) / (score.total + previous.total);
    const standardError = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / score.total + 1 / previous.total));
    const zScore = standardError === 0 ? 0 : (score.rate - previous.rate) / standardError;
    return [
      {
        pair: score.pair,
        baselineRate: previous.rate,
        currentRate: score.rate,
        zScore,
        significant: score.rate < previous.rate && zScore <= -1.96,
      },
    ];
  });
}

function releaseGates(
  dimensionScores: TranslationBenchmarkReport["dimensionScores"],
  regressions: BenchmarkRegression[],
  results: BenchmarkCaseResult[],
): ReleaseGate[] {
  const simplePathResults = results.filter((result) => result.case.assertions.expectedSimplePath);
  const simplePathPassed = simplePathResults.every(
    (result) =>
      result.status === "completed" &&
      result.decision.status === "accepted" &&
      result.decision.quality.judgeResult === undefined &&
      result.decision.quality.attemptCount === 1,
  );
  return [
    {
      id: "immutable-preservation",
      passed: dimensionScores.factualPreservation.rate === 1,
      actual: percentage(dimensionScores.factualPreservation.rate),
      required: "100%",
    },
    {
      id: "ambiguity-handling",
      passed: dimensionScores.ambiguityHandling.rate === 1,
      actual: percentage(dimensionScores.ambiguityHandling.rate),
      required: "100%",
    },
    {
      id: "primary-translation",
      passed: dimensionScores.primaryTranslation.rate >= 0.95,
      actual: percentage(dimensionScores.primaryTranslation.rate),
      required: ">=95%",
    },
    {
      id: "auxiliary-fields",
      passed: dimensionScores.auxiliaryFields.rate >= 0.9,
      actual: percentage(dimensionScores.auxiliaryFields.rate),
      required: ">=90%",
    },
    {
      id: "language-pair-regression",
      passed: regressions.every((regression) => !regression.significant),
      actual: `${regressions.filter((regression) => regression.significant).length} significant`,
      required: "0 significant",
    },
    {
      id: "simple-path",
      passed: simplePathResults.length > 0 && simplePathPassed,
      actual: simplePathResults.length === 0 ? "not measured" : simplePathPassed ? "single-call" : "judge/retry used",
      required: "single-call, no judge",
    },
  ];
}

export async function runTranslationBenchmark(
  options: RunTranslationBenchmarkOptions,
): Promise<TranslationBenchmarkReport> {
  const runsPerCase = options.runsPerCase ?? 1;
  if (!Number.isInteger(runsPerCase) || runsPerCase < 1) {
    throw new Error("runsPerCase must be a positive integer");
  }

  const detectionResults: DetectionBenchmarkResult[] = [];
  const results: BenchmarkCaseResult[] = [];

  for (const detectionCase of options.detectionCases) {
    for (let run = 1; run <= runsPerCase; run++) {
      detectionResults.push(
        await runDetectionCase(detectionCase, run, options.detectLanguageFn, options.consumeRequestMetrics),
      );
    }
  }

  for (const benchmarkCase of options.cases) {
    for (let run = 1; run <= runsPerCase; run++) {
      results.push(
        await runCase(benchmarkCase, run, options.model, options.generateObjectFn, options.consumeRequestMetrics),
      );
    }
  }

  const completed = results.filter((result) => result.status === "completed").length;
  const qualityPassed = results.filter((result) => result.status === "completed" && result.qualityPassed).length;
  const matchedDetections = detectionResults.filter((result) => result.matchesExpectation).length;
  const requestMetrics = [...detectionResults, ...results].flatMap((result) => result.requestMetrics);
  const metricTotals = sumMetrics(requestMetrics);
  const pairScores = languagePairScores(results);
  const regressions = options.baseline
    ? compareLanguagePairScores(pairScores, options.baseline.languagePairScores)
    : [];
  const detectionScore = {
    passed: matchedDetections,
    total: detectionResults.length,
    rate: rate(matchedDetections, detectionResults.length),
  };
  const dimensionScores = {
    primaryTranslation: scoreDimension(results, "primaryTranslation"),
    auxiliaryFields: scoreDimension(results, "auxiliaryFields"),
    factualPreservation: scoreDimension(results, "factualPreservation"),
    naturalnessRegister: scoreDimension(results, "naturalnessRegister"),
    ambiguityHandling: scoreDimension(results, "ambiguityHandling"),
    detectionAccuracy: detectionScore,
    repairSuccess: scoreRepairSuccess(results),
  };
  const report: TranslationBenchmarkReport = {
    schemaVersion: 4,
    fixtureVersion: 1,
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    model: options.model,
    runsPerCase,
    modelSettings: MODEL_SETTINGS,
    summary: {
      cases: options.cases.length,
      executions: results.length,
      completed,
      failed: results.length - completed,
      qualityPassed,
      qualityFailed: results.length - qualityPassed,
      passRate: rate(qualityPassed, results.length),
      latencyMs: [...detectionResults, ...results].reduce((total, result) => total + result.durationMs, 0),
      ...metricTotals,
    },
    dimensionScores,
    languagePairScores: pairScores,
    regressions,
    releaseGates: releaseGates(dimensionScores, regressions, results),
    detectionSummary: {
      total: detectionResults.length,
      matched: matchedDetections,
      mismatched: detectionResults.length - matchedDetections,
    },
    detectionResults,
    results,
  };

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, renderBenchmarkReportMarkdown(report), "utf8");
  if (options.jsonOutputPath) {
    await mkdir(dirname(options.jsonOutputPath), { recursive: true });
    await writeFile(options.jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  return report;
}
