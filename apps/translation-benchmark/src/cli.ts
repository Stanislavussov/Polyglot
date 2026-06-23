import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AIRequestLog, generateObject, generateText, setAIRequestMetricSink } from "@polyglot/adapter-ai";
import { closeDb, createContextLookup } from "@polyglot/adapter-db";
import { detectLanguageWithConfidenceAsync } from "@polyglot/core";
import { config } from "dotenv";
import { TRANSLATION_BENCHMARK_CASES } from "./benchmark-cases.js";
import { type BenchmarkGroup, selectBenchmarkCases } from "./benchmark-groups.js";
import {
  type BenchmarkRequestMetric,
  runTranslationBenchmark,
  type TranslationBenchmarkReport,
} from "./benchmark-runner.js";
import { DETECTION_BENCHMARK_CASES } from "./detection-cases.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

interface CliOptions {
  group: BenchmarkGroup;
  models: string[];
  runsPerCase: number;
  outputPath: string;
  baselinePath?: string;
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function defaultOutputPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return resolve(REPOSITORY_ROOT, "docs", "translation-benchmarks", `translation-benchmark-${timestamp}.md`);
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function parseCliOptions(args: string[], env: NodeJS.ProcessEnv): CliOptions {
  const explicitModelList = argumentValue(args, "--models");
  const modelList = explicitModelList ?? argumentValue(args, "--model") ?? env.AI_MODEL;
  const models = modelList
    ?.split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
  if (!models || models.length === 0) {
    throw new Error("Model is required. Pass --models <id,id,...>, --model <id>, or set AI_MODEL.");
  }
  if (explicitModelList !== undefined && models.length < 3) {
    throw new Error("--models requires at least three model IDs for economy, mid-tier, and strong comparison.");
  }

  const groupValue = argumentValue(args, "--group") ?? "all";
  if (groupValue !== "all" && groupValue !== "smoke") {
    throw new Error(`Unknown benchmark group "${groupValue}". Use "all" or "smoke".`);
  }

  const outputPath = resolve(argumentValue(args, "--output") ?? defaultOutputPath());
  const baselineValue = argumentValue(args, "--baseline");
  return {
    group: groupValue,
    models,
    runsPerCase: parsePositiveInteger(argumentValue(args, "--runs"), 3, "--runs"),
    outputPath,
    ...(baselineValue ? { baselinePath: resolve(baselineValue) } : {}),
  };
}

function reportPath(outputPath: string, model: string, multipleModels: boolean): string {
  if (!multipleModels) return outputPath;
  const extension = extname(outputPath);
  const stem = outputPath.slice(0, -extension.length);
  const slug = model.replaceAll(/[^a-zA-Z0-9.-]+/g, "-");
  return `${stem}-${slug}${extension}`;
}

function jsonPath(markdownPath: string): string {
  return `${markdownPath.slice(0, -extname(markdownPath).length)}.json`;
}

function renderComparison(reports: TranslationBenchmarkReport[]): string {
  const modelClasses = ["economy", "mid-tier", "strong"] as const;
  return `${[
    "# Translation model comparison",
    "",
    "| Class | Model | Pass rate | Primary | Auxiliary | Detection | Latency | Cost | Release gates |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...reports.map((report, index) => {
      const passedGates = report.releaseGates.filter((gate) => gate.passed).length;
      return `| ${modelClasses[index] ?? "additional"} | ${report.model} | ${(report.summary.passRate * 100).toFixed(1)}% | ${(report.dimensionScores.primaryTranslation.rate * 100).toFixed(1)}% | ${(report.dimensionScores.auxiliaryFields.rate * 100).toFixed(1)}% | ${(report.dimensionScores.detectionAccuracy.rate * 100).toFixed(1)}% | ${report.summary.latencyMs} ms | $${report.summary.costUsd.toFixed(6)} | ${passedGates}/${report.releaseGates.length} |`;
    }),
    "",
  ].join("\n")}\n`;
}

async function loadBaseline(path: string | undefined): Promise<TranslationBenchmarkReport | undefined> {
  if (!path) return undefined;
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("schemaVersion" in parsed) || parsed.schemaVersion !== 4) {
    throw new Error("Baseline must be a benchmark JSON report with schemaVersion 4.");
  }
  return parsed as TranslationBenchmarkReport;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env);
  const contextLookup = createContextLookup();
  const selectedCases = selectBenchmarkCases(options.group, TRANSLATION_BENCHMARK_CASES, DETECTION_BENCHMARK_CASES);
  const baseline = await loadBaseline(options.baselinePath);
  const metrics: BenchmarkRequestMetric[] = [];
  const consumeRequestMetrics = (): BenchmarkRequestMetric[] => metrics.splice(0);
  setAIRequestMetricSink((metric: AIRequestLog) => {
    metrics.push({
      model: metric.model,
      requestKind: metric.requestKind,
      inputTokens: metric.tokens.input,
      outputTokens: metric.tokens.output,
      costUsd: metric.cost_usd,
      durationMs: metric.duration_ms,
      success: metric.success,
    });
  });

  const reports: TranslationBenchmarkReport[] = [];
  try {
    for (const model of options.models) {
      const outputPath = reportPath(options.outputPath, model, options.models.length > 1);
      const report = await runTranslationBenchmark({
        model,
        outputPath,
        jsonOutputPath: jsonPath(outputPath),
        ...(baseline?.model === model ? { baseline } : {}),
        runsPerCase: options.runsPerCase,
        generateObjectFn: generateObject,
        cases: selectedCases.translationCases,
        detectionCases: selectedCases.detectionCases,
        detectLanguageFn: (text, candidates) =>
          detectLanguageWithConfidenceAsync(text, candidates, {
            contextLookup,
            aiGenerate: (prompt) => generateText(prompt, model),
          }),
        consumeRequestMetrics,
      });
      reports.push(report);
      process.stdout.write(`Translation benchmark report saved to ${outputPath}\n`);
      process.stdout.write(
        `${model}: ${report.summary.qualityPassed}/${report.summary.executions} quality passes; ${report.detectionSummary.matched}/${report.detectionSummary.total} detections; $${report.summary.costUsd.toFixed(6)}\n`,
      );
    }
  } finally {
    setAIRequestMetricSink(null);
  }

  if (reports.length > 1) {
    await writeFile(options.outputPath, renderComparison(reports), "utf8");
    process.stdout.write(`Model comparison saved to ${options.outputPath}\n`);
  }

  if (
    reports.some(
      (report) =>
        report.summary.failed > 0 ||
        report.summary.qualityFailed > 0 ||
        report.detectionSummary.mismatched > 0 ||
        report.releaseGates.some((gate) => !gate.passed),
    )
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
