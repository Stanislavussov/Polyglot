import type { DetectionBenchmarkCase, TranslationBenchmarkCase } from "./benchmark-runner.js";

export type BenchmarkGroup = "all" | "smoke";

const SMOKE_TRANSLATION_IDS = new Set([
  "polysemy-bank-river",
  "idiom-break-a-leg",
  "slang-lit-party",
  "formal-german-request",
  "placeholder-preservation",
]);

const SMOKE_DETECTION_IDS = new Set([
  "fast-en-de",
  "fast-english-context",
  "fast-german-context",
  "fast-reversed-candidates",
  "ru-uk-privet",
  "ru-uk-context-ukrainian",
  "code-switch-russian-english",
  "brand-telegram-russian-context",
  "transliterated-russian",
  "typo-english",
]);

export function selectBenchmarkCases(
  group: BenchmarkGroup,
  translationCases: TranslationBenchmarkCase[],
  detectionCases: DetectionBenchmarkCase[],
): {
  translationCases: TranslationBenchmarkCase[];
  detectionCases: DetectionBenchmarkCase[];
} {
  if (group === "all") {
    return { translationCases, detectionCases };
  }

  return {
    translationCases: translationCases.filter((benchmarkCase) => SMOKE_TRANSLATION_IDS.has(benchmarkCase.id)),
    detectionCases: detectionCases.filter((benchmarkCase) => SMOKE_DETECTION_IDS.has(benchmarkCase.id)),
  };
}
