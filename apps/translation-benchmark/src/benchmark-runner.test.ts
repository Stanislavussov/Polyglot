import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerateObjectFn } from "@polyglot/core";
import { SENTENCE_OUTPUT } from "@polyglot/core";
import { afterEach, describe, expect, it } from "vitest";
import type { ZodSchema } from "zod";
import {
  evaluateTranslationQuality,
  renderBenchmarkReportMarkdown,
  runTranslationBenchmark,
  type TranslationBenchmarkCase,
} from "./benchmark-runner.js";

const tempDirectories: string[] = [];

async function createOutputPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "polyglot-translation-benchmark-"));
  tempDirectories.push(directory);
  return join(directory, "nested", "report.md");
}

function sentenceCase(id: string, word: string): TranslationBenchmarkCase {
  return {
    fixtureVersion: 1,
    id,
    category: "integration-test",
    description: "Exercises the benchmark pipeline.",
    expectedMeaning: "A valid Russian sentence.",
    qualityRisks: ["external generation failure"],
    assertions: { expectedAction: "translate" },
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

    const savedReport = await readFile(outputPath, "utf8");

    expect(report.summary).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      qualityPassed: 1,
      qualityFailed: 0,
    });
    expect(report.detectionSummary).toEqual({ total: 1, matched: 1, mismatched: 0 });
    expect(savedReport).toContain("# Translation benchmark report");
    expect(savedReport).toContain("`test/model`");
    expect(savedReport).toContain("| fast-en-de | fast | ask_source_language | — | PASS |");
    expect(savedReport).toContain('"text": "Это корректное русское предложение."');
    expect(report.results[0]).toMatchObject({
      status: "completed",
      qualityPassed: true,
      qualityIssues: [],
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

    const savedReport = await readFile(outputPath, "utf8");

    expect(report.summary).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      qualityPassed: 1,
      qualityFailed: 1,
    });
    expect(report.results[0]).toMatchObject({
      status: "failed",
      error: "simulated provider failure",
    });
    expect(report.results[0].attempts).toHaveLength(3);
    expect(report.results[1]).toMatchObject({
      status: "completed",
      case: { id: "success-after-failure" },
    });
    expect(savedReport).toContain("Error: simulated provider failure");
  });
});

describe("renderBenchmarkReportMarkdown", () => {
  it("escapes table separators in detection input", () => {
    const markdown = renderBenchmarkReportMarkdown({
      schemaVersion: 3,
      promptVersion: "translation-v1",
      generatedAt: "2026-06-22T00:00:00.000Z",
      model: "test/model",
      modelSettings: {
        temperature: 0.3,
        frequencyPenalty: 0,
        providerMaxRetries: 2,
      },
      summary: { total: 0, completed: 0, failed: 0, qualityPassed: 0, qualityFailed: 0 },
      detectionSummary: { total: 1, matched: 1, mismatched: 0 },
      detectionResults: [
        {
          case: {
            id: "separator",
            category: "code-switching",
            text: "hello | hola",
            candidates: ["en", "es"],
            expectedAction: "ask_source_language",
            explanation: "Mixed input.",
          },
          matchesExpectation: true,
          durationMs: 1,
        },
      ],
      results: [],
    });

    expect(markdown).toContain("hello \\| hola");
  });
});

describe("evaluateTranslationQuality", () => {
  it("reports clarification and immutable-token failures", () => {
    const benchmarkCase: TranslationBenchmarkCase = {
      ...sentenceCase("ambiguous-date", "Meet on 06/07 at {time}."),
      assertions: {
        expectedAction: "needs_clarification",
        immutableTokens: ["06/07", "{time}"],
      },
    };

    const issues = evaluateTranslationQuality(benchmarkCase, {
      original: benchmarkCase.input.word,
      sourceLang: "en",
      emoji: "📅",
      nativeSynonyms: [],
      translations: {
        ru: {
          text: "Встретимся 7 июня.",
          synonyms: [],
          examples: [],
        },
      },
    });

    expect(issues).toContain("Expected clarification, but the translation pipeline produced a translation");
    expect(issues).toContain('translations.ru.text must preserve "06/07" byte-for-byte (1 expected, 0 found)');
    expect(issues).toContain('translations.ru.text must preserve "{time}" byte-for-byte (1 expected, 0 found)');
  });

  it("checks forbidden meanings and required metadata", () => {
    const benchmarkCase: TranslationBenchmarkCase = {
      ...sentenceCase("bank", "bank"),
      assertions: {
        expectedAction: "translate",
        forbiddenSubstrings: { ru: ["банк"] },
        requiredMetadata: ["nativeMeaning"],
      },
    };

    const issues = evaluateTranslationQuality(benchmarkCase, {
      original: "bank",
      sourceLang: "en",
      emoji: "🏦",
      nativeSynonyms: [],
      translations: {
        ru: {
          text: "банк",
          synonyms: [],
          examples: [],
        },
      },
    });

    expect(issues).toEqual([
      'translations.ru.text contains forbidden text "банк"',
      "nativeMeaning metadata is required",
    ]);
  });
});
