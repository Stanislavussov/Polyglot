import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateObject, generateText } from "@polyglot/adapter-ai";
import { createContextLookup } from "@polyglot/adapter-db";
import { detectLanguageAsync } from "@polyglot/core";
import { config } from "dotenv";
import { TRANSLATION_BENCHMARK_CASES } from "./benchmark-cases.js";
import { type BenchmarkGroup, selectBenchmarkCases } from "./benchmark-groups.js";
import { runTranslationBenchmark } from "./benchmark-runner.js";
import { DETECTION_BENCHMARK_CASES } from "./detection-cases.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

interface CliOptions {
  group: BenchmarkGroup;
  model: string;
  outputPath: string;
}

function argumentValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function defaultOutputPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return resolve("translation-benchmark-results", `translation-benchmark-${timestamp}.json`);
}

export function parseCliOptions(args: string[], env: NodeJS.ProcessEnv): CliOptions {
  const model = argumentValue(args, "--model") ?? env.AI_MODEL;
  if (!model) {
    throw new Error("Model is required. Pass --model <openrouter-model-id> or set AI_MODEL.");
  }

  const groupValue = argumentValue(args, "--group") ?? "all";
  if (groupValue !== "all" && groupValue !== "smoke") {
    throw new Error(`Unknown benchmark group "${groupValue}". Use "all" or "smoke".`);
  }

  const outputPath = resolve(argumentValue(args, "--output") ?? defaultOutputPath());
  return { group: groupValue, model, outputPath };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2), process.env);
  const contextLookup = createContextLookup();
  const selectedCases = selectBenchmarkCases(options.group, TRANSLATION_BENCHMARK_CASES, DETECTION_BENCHMARK_CASES);
  const report = await runTranslationBenchmark({
    model: options.model,
    outputPath: options.outputPath,
    generateObjectFn: generateObject,
    cases: selectedCases.translationCases,
    detectionCases: selectedCases.detectionCases,
    detectLanguageFn: (text, candidates) =>
      detectLanguageAsync(text, candidates, {
        contextLookup,
        aiGenerate: (prompt) => generateText(prompt, options.model),
      }),
  });

  process.stdout.write(`Translation benchmark report saved to ${options.outputPath}\n`);
  process.stdout.write(`Group: ${options.group}\n`);
  process.stdout.write(
    `Completed: ${report.summary.completed}/${report.summary.total}; failed: ${report.summary.failed}\n`,
  );
  process.stdout.write(
    `Detection matched: ${report.detectionSummary.matched}/${report.detectionSummary.total}; mismatched: ${report.detectionSummary.mismatched}\n`,
  );

  if (report.summary.failed > 0 || report.detectionSummary.mismatched > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
