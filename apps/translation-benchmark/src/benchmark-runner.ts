import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  DetectionEvidence,
  DetectionResult,
  GenerateObjectFn,
  TranslateInput,
  TranslationDecision,
} from "@polyglot/core";
import { translate } from "@polyglot/core";
import type { ZodSchema } from "zod";

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
  requiredMetadata?: Array<"nativeMeaning" | "sourceUsage">;
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

interface BenchmarkAttempt {
  attempt: number;
  prompt: string;
  response?: unknown;
  error?: string;
}

interface CompletedBenchmarkCase {
  case: TranslationBenchmarkCase;
  status: "completed";
  qualityPassed: boolean;
  qualityIssues: string[];
  durationMs: number;
  attempts: BenchmarkAttempt[];
  decision: TranslationDecision;
}

interface FailedBenchmarkCase {
  case: TranslationBenchmarkCase;
  status: "failed";
  durationMs: number;
  attempts: BenchmarkAttempt[];
  error: string;
}

export type BenchmarkCaseResult = CompletedBenchmarkCase | FailedBenchmarkCase;

export interface DetectionBenchmarkResult {
  case: DetectionBenchmarkCase;
  observedSourceLang?: string;
  confidence: number;
  evidence?: DetectionEvidence[];
  ambiguousCandidates?: string[];
  matchesExpectation: boolean;
  durationMs: number;
  error?: string;
}

export interface TranslationBenchmarkReport {
  schemaVersion: 3;
  promptVersion: string;
  generatedAt: string;
  model: string;
  modelSettings: {
    temperature: number;
    frequencyPenalty: number;
    providerMaxRetries: number;
  };
  summary: {
    total: number;
    completed: number;
    failed: number;
    qualityPassed: number;
    qualityFailed: number;
  };
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
  generateObjectFn: GenerateObjectFn;
  cases: TranslationBenchmarkCase[];
  detectionCases: DetectionBenchmarkCase[];
  detectLanguageFn: (text: string, candidates: string[]) => Promise<DetectionResult>;
}

const PROMPT_VERSION = "translation-v1";
const MODEL_SETTINGS = {
  temperature: 0.3,
  frequencyPenalty: 0,
  providerMaxRetries: 2,
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tableCell(value: string | undefined): string {
  return (value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderBenchmarkReportMarkdown(report: TranslationBenchmarkReport): string {
  const lines = [
    "# Translation benchmark report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Model: \`${report.model}\``,
    `- Prompt version: \`${report.promptVersion}\``,
    `- Schema version: \`${report.schemaVersion}\``,
    `- Model settings: temperature=${report.modelSettings.temperature}, frequencyPenalty=${report.modelSettings.frequencyPenalty}, providerMaxRetries=${report.modelSettings.providerMaxRetries}`,
    `- Translations: ${report.summary.completed}/${report.summary.total} completed, ${report.summary.failed} failed`,
    `- Quality assertions: ${report.summary.qualityPassed}/${report.summary.total} passed, ${report.summary.qualityFailed} failed`,
    `- Detection: ${report.detectionSummary.matched}/${report.detectionSummary.total} matched, ${report.detectionSummary.mismatched} mismatched`,
    "",
    "## Source-language detection",
    "",
    "| Case | Input | Expected | Observed | Result |",
    "|---|---|---|---|---|",
    ...report.detectionResults.map((result) => {
      const expected =
        result.case.expectedAction === "ask_source_language" ? "ask_source_language" : result.case.expectedSourceLang;
      return `| ${tableCell(result.case.id)} | ${tableCell(result.case.text)} | ${tableCell(expected)} | ${tableCell(result.observedSourceLang)} | ${result.matchesExpectation ? "PASS" : "FAIL"} |`;
    }),
    "",
    "## Translation results",
    "",
  ];

  for (const result of report.results) {
    lines.push(
      `### ${result.case.id}`,
      "",
      `- Category: ${result.case.category}`,
      `- Input: ${result.case.input.word}`,
      `- Source: ${result.case.input.sourceLang}`,
      `- Targets: ${result.case.input.targetLangs.join(", ")}`,
      `- Native language: ${result.case.input.nativeLang ?? "not configured"}`,
      `- Expected meaning: ${result.case.expectedMeaning}`,
      `- Quality risks: ${result.case.qualityRisks.join("; ")}`,
      `- Status: ${result.status}`,
      `- Duration: ${result.durationMs} ms`,
      "",
    );

    if (result.status === "completed") {
      lines.push(
        `- Quality assertions: ${result.qualityPassed ? "PASS" : "FAIL"}`,
        ...(result.qualityIssues.length > 0
          ? ["- Quality issues:", ...result.qualityIssues.map((issue) => `  - ${issue}`)]
          : []),
        "",
      );
      lines.push("```json", JSON.stringify(result.decision, null, 2), "```", "");
    } else {
      lines.push(`Error: ${result.error}`, "");
    }

    lines.push("#### Raw attempts", "");
    for (const attempt of result.attempts) {
      lines.push(
        `Attempt ${attempt.attempt}:`,
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

export function evaluateTranslationQuality(
  benchmarkCase: TranslationBenchmarkCase,
  decision: TranslationDecision,
): string[] {
  const issues: string[] = [];
  const assertions = benchmarkCase.assertions;

  if (decision.status === "needs_clarification") {
    if (assertions.expectedAction === "needs_clarification") {
      return issues;
    }
    issues.push("Pipeline returned needs_clarification, but the case expects a translation");
    return issues;
  }

  if (assertions.expectedAction === "needs_clarification") {
    issues.push(`Expected needs_clarification, but the pipeline returned status="${decision.status}"`);
  }

  if (decision.status === "needs_review") {
    issues.push("Pipeline returned needs_review — validation failed after all retries");
  }

  const result = decision.output;

  for (const [lang, translation] of Object.entries(result.translations)) {
    const source = benchmarkCase.input.word;
    for (const token of assertions.immutableTokens ?? []) {
      const expectedCount = countOccurrences(source, token);
      const actualCount = countOccurrences(translation.text, token);
      if (actualCount !== expectedCount) {
        issues.push(
          `translations.${lang}.text must preserve "${token}" byte-for-byte (${expectedCount} expected, ${actualCount} found)`,
        );
      }
    }

    const normalizedText = translation.text.toLocaleLowerCase();
    for (const required of assertions.requiredSubstrings?.[lang] ?? []) {
      if (!normalizedText.includes(required.toLocaleLowerCase())) {
        issues.push(`translations.${lang}.text is missing required text "${required}"`);
      }
    }
    for (const forbidden of assertions.forbiddenSubstrings?.[lang] ?? []) {
      if (normalizedText.includes(forbidden.toLocaleLowerCase())) {
        issues.push(`translations.${lang}.text contains forbidden text "${forbidden}"`);
      }
    }
  }

  for (const field of assertions.requiredMetadata ?? []) {
    if (result[field] === undefined) {
      issues.push(`${field} metadata is required`);
    }
  }

  return issues;
}

async function runCase(
  benchmarkCase: TranslationBenchmarkCase,
  model: string,
  generateObjectFn: GenerateObjectFn,
): Promise<BenchmarkCaseResult> {
  const attempts: BenchmarkAttempt[] = [];
  const trackedGenerateObject: GenerateObjectFn = async <T>(
    prompt: string,
    schema: ZodSchema<T>,
    requestedModel: string,
    options?: { userId?: number; frequencyPenalty?: number },
  ): Promise<T> => {
    const attempt: BenchmarkAttempt = {
      attempt: attempts.length + 1,
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
    const qualityIssues = evaluateTranslationQuality(benchmarkCase, decision);
    return {
      case: benchmarkCase,
      status: "completed",
      qualityPassed: qualityIssues.length === 0,
      qualityIssues,
      durationMs: Date.now() - startedAt,
      attempts,
      decision,
    };
  } catch (error) {
    return {
      case: benchmarkCase,
      status: "failed",
      durationMs: Date.now() - startedAt,
      attempts,
      error: errorMessage(error),
    };
  }
}

async function runDetectionCase(
  benchmarkCase: DetectionBenchmarkCase,
  detectLanguageFn: RunTranslationBenchmarkOptions["detectLanguageFn"],
): Promise<DetectionBenchmarkResult> {
  const startedAt = Date.now();

  try {
    const detection = await detectLanguageFn(benchmarkCase.text, benchmarkCase.candidates);
    const observedSourceLang = detection.language;
    return {
      case: benchmarkCase,
      ...(observedSourceLang !== undefined ? { observedSourceLang } : {}),
      confidence: detection.confidence,
      ...(detection.evidence.length > 0 ? { evidence: detection.evidence } : {}),
      ...(detection.ambiguousCandidates ? { ambiguousCandidates: detection.ambiguousCandidates } : {}),
      matchesExpectation: observedSourceLang === benchmarkCase.expectedSourceLang,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      case: benchmarkCase,
      confidence: 0,
      matchesExpectation: false,
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

export async function runTranslationBenchmark(
  options: RunTranslationBenchmarkOptions,
): Promise<TranslationBenchmarkReport> {
  const detectionResults: DetectionBenchmarkResult[] = [];
  const results: BenchmarkCaseResult[] = [];

  for (const detectionCase of options.detectionCases) {
    detectionResults.push(await runDetectionCase(detectionCase, options.detectLanguageFn));
  }

  for (const benchmarkCase of options.cases) {
    results.push(await runCase(benchmarkCase, options.model, options.generateObjectFn));
  }

  const completed = results.filter((result) => result.status === "completed").length;
  const qualityPassed = results.filter((result) => result.status === "completed" && result.qualityPassed).length;
  const matchedDetections = detectionResults.filter((result) => result.matchesExpectation).length;
  const report: TranslationBenchmarkReport = {
    schemaVersion: 3,
    promptVersion: PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    model: options.model,
    modelSettings: MODEL_SETTINGS,
    summary: {
      total: results.length,
      completed,
      failed: results.length - completed,
      qualityPassed,
      qualityFailed: results.length - qualityPassed,
    },
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

  return report;
}
