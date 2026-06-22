import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GenerateObjectFn, TranslateInput, TranslateOutput } from "@polyglot/core";
import { translate } from "@polyglot/core";
import type { ZodSchema } from "zod";

export interface TranslationBenchmarkCase {
  id: string;
  category: string;
  description: string;
  expectedMeaning: string;
  qualityRisks: string[];
  input: Omit<TranslateInput, "model" | "userId">;
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
  durationMs: number;
  attempts: BenchmarkAttempt[];
  result: TranslateOutput;
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
  matchesExpectation: boolean;
  durationMs: number;
  error?: string;
}

export interface TranslationBenchmarkReport {
  schemaVersion: 2;
  generatedAt: string;
  model: string;
  summary: {
    total: number;
    completed: number;
    failed: number;
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
  detectLanguageFn: (text: string, candidates: string[]) => Promise<string | undefined>;
}

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
    `- Translations: ${report.summary.completed}/${report.summary.total} completed, ${report.summary.failed} failed`,
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
      lines.push("```json", JSON.stringify(result.result, null, 2), "```", "");
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
    const result = await translate({ ...benchmarkCase.input, model }, trackedGenerateObject);
    return {
      case: benchmarkCase,
      status: "completed",
      durationMs: Date.now() - startedAt,
      attempts,
      result,
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
    const observedSourceLang = await detectLanguageFn(benchmarkCase.text, benchmarkCase.candidates);
    return {
      case: benchmarkCase,
      ...(observedSourceLang !== undefined ? { observedSourceLang } : {}),
      matchesExpectation: observedSourceLang === benchmarkCase.expectedSourceLang,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      case: benchmarkCase,
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
  const matchedDetections = detectionResults.filter((result) => result.matchesExpectation).length;
  const report: TranslationBenchmarkReport = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    model: options.model,
    summary: {
      total: results.length,
      completed,
      failed: results.length - completed,
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
