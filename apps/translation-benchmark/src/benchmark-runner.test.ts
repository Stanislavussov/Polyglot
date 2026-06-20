import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateObjectFn } from "@polyglot/core";
import { SENTENCE_OUTPUT } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import type { ZodSchema } from "zod";
import {
  runTranslationBenchmark,
  type TranslationBenchmarkCase,
  type TranslationBenchmarkReport,
} from "./benchmark-runner.js";

const tempDirectories: string[] = [];

async function createOutputPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "polyglot-translation-benchmark-"));
  tempDirectories.push(directory);
  return join(directory, "nested", "report.json");
}

function sentenceCase(id: string, word: string): TranslationBenchmarkCase {
  return {
    id,
    category: "integration-test",
    description: "Exercises the benchmark pipeline.",
    expectedMeaning: "A valid Russian sentence.",
    qualityRisks: ["external generation failure"],
    input: {
      word,
      sourceLang: "en",
      targetLangs: ["ru"],
      nativeLang: "cs",
      inputType: "sentence",
      outputConfig: SENTENCE_OUTPUT,
    },
  };
}

const successfulGeneration: GenerateObjectFn = async <T>(_prompt: string, schema: ZodSchema<T>): Promise<T> =>
  schema.parse({
    emoji: "✅",
    nativeMeaning: "České vysvětlení významu.",
    translations: {
      ru: {
        text: "Это корректное русское предложение.",
      },
    },
  });

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("runTranslationBenchmark", () => {
  it("runs the real translation and validation pipeline and writes an analysis-ready report", async () => {
    const outputPath = await createOutputPath();

    const report = await runTranslationBenchmark({
      model: "test/model",
      outputPath,
      generateObjectFn: successfulGeneration,
      cases: [sentenceCase("success", "Translate this sentence.")],
      detectionCases: [
        {
          id: "fast-en-de",
          category: "ambiguous-homograph",
          text: "fast",
          candidates: ["en", "de"],
          expectedAction: "ask_source_language",
          explanation: "Shared spelling.",
        },
      ],
      detectLanguageFn: async () => undefined,
    });

    const savedReport = JSON.parse(await readFile(outputPath, "utf8")) as TranslationBenchmarkReport;

    expect(report.summary).toEqual({ total: 1, completed: 1, failed: 0 });
    expect(report.detectionSummary).toEqual({ total: 1, matched: 1, mismatched: 0 });
    expect(savedReport.detectionResults[0]).toMatchObject({
      case: {
        id: "fast-en-de",
        expectedAction: "ask_source_language",
      },
      matchesExpectation: true,
    });
    expect(savedReport.model).toBe("test/model");
    expect(savedReport.results[0]).toMatchObject({
      status: "completed",
      case: {
        id: "success",
        expectedMeaning: "A valid Russian sentence.",
      },
      attempts: [
        {
          attempt: 1,
          response: {
            translations: {
              ru: {
                text: "Это корректное русское предложение.",
              },
            },
          },
        },
      ],
      result: {
        original: "Translate this sentence.",
        translations: {
          ru: {
            text: "Это корректное русское предложение.",
          },
        },
      },
    });
  });

  it("records a failed case after pipeline retries and continues with the next case", async () => {
    const outputPath = await createOutputPath();
    const generateObjectFn: GenerateObjectFn = async <T>(prompt: string, schema: ZodSchema<T>): Promise<T> => {
      if (prompt.includes("Always fail")) {
        throw new Error("simulated provider failure");
      }
      return successfulGeneration(prompt, schema, "test/model");
    };

    const report = await runTranslationBenchmark({
      model: "test/model",
      outputPath,
      generateObjectFn,
      cases: [
        sentenceCase("failure", "Always fail."),
        sentenceCase("success-after-failure", "Translate this sentence."),
      ],
      detectionCases: [],
      detectLanguageFn: async () => undefined,
    });

    const savedReport = JSON.parse(await readFile(outputPath, "utf8")) as TranslationBenchmarkReport;

    expect(report.summary).toEqual({ total: 2, completed: 1, failed: 1 });
    expect(savedReport.results[0]).toMatchObject({
      status: "failed",
      error: "simulated provider failure",
    });
    expect(savedReport.results[0].attempts).toHaveLength(3);
    expect(savedReport.results[1]).toMatchObject({
      status: "completed",
      case: { id: "success-after-failure" },
    });
  });
});
