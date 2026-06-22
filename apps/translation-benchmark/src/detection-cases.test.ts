import { describe, expect, it } from "vitest";
import { DETECTION_BENCHMARK_CASES } from "./detection-cases.js";

describe("DETECTION_BENCHMARK_CASES", () => {
  it("contains a broad, uniquely identified scenario set", () => {
    const ids = DETECTION_BENCHMARK_CASES.map((benchmarkCase) => benchmarkCase.id);
    const categories = new Set(DETECTION_BENCHMARK_CASES.map((benchmarkCase) => benchmarkCase.category));

    expect(DETECTION_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(ids).size).toBe(ids.length);
    expect(categories.size).toBeGreaterThanOrEqual(7);
  });

  it("keeps expected actions consistent with expected source languages", () => {
    for (const benchmarkCase of DETECTION_BENCHMARK_CASES) {
      expect(benchmarkCase.candidates.length).toBeGreaterThanOrEqual(2);
      expect(benchmarkCase.explanation.length).toBeGreaterThan(0);

      if (benchmarkCase.expectedAction === "translate") {
        expect(benchmarkCase.expectedSourceLang).toBeDefined();
        expect(benchmarkCase.candidates).toContain(benchmarkCase.expectedSourceLang);
      } else {
        expect(benchmarkCase.expectedSourceLang).toBeUndefined();
      }
    }
  });

  it("covers both clarification and direct-translation decisions", () => {
    const clarificationCases = DETECTION_BENCHMARK_CASES.filter(
      (benchmarkCase) => benchmarkCase.expectedAction === "ask_source_language",
    );
    const translationCases = DETECTION_BENCHMARK_CASES.filter(
      (benchmarkCase) => benchmarkCase.expectedAction === "translate",
    );

    expect(clarificationCases.length).toBeGreaterThanOrEqual(30);
    expect(translationCases.length).toBeGreaterThanOrEqual(25);
  });
});
