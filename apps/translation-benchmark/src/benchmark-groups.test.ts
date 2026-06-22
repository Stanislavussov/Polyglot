import { describe, expect, it } from "vitest";
import { TRANSLATION_BENCHMARK_CASES } from "./benchmark-cases.js";
import { selectBenchmarkCases } from "./benchmark-groups.js";
import { DETECTION_BENCHMARK_CASES } from "./detection-cases.js";

describe("selectBenchmarkCases", () => {
  it("selects a small representative smoke group", () => {
    const selected = selectBenchmarkCases("smoke", TRANSLATION_BENCHMARK_CASES, DETECTION_BENCHMARK_CASES);

    expect(selected.translationCases).toHaveLength(5);
    expect(selected.detectionCases).toHaveLength(10);
    expect(selected.translationCases.map((benchmarkCase) => benchmarkCase.id)).toContain("idiom-break-a-leg");
    expect(selected.detectionCases.map((benchmarkCase) => benchmarkCase.id)).toContain("fast-en-de");
  });

  it("keeps the complete benchmark unchanged for the all group", () => {
    const selected = selectBenchmarkCases("all", TRANSLATION_BENCHMARK_CASES, DETECTION_BENCHMARK_CASES);

    expect(selected.translationCases).toBe(TRANSLATION_BENCHMARK_CASES);
    expect(selected.detectionCases).toBe(DETECTION_BENCHMARK_CASES);
  });
});
