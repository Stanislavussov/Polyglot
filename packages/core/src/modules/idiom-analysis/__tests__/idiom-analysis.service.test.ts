import { describe, expect, it, vi } from "vitest";
import type { GenerateObjectFn } from "../../../ports/ai.port.js";
import { getLanguageName } from "../../i18n/language-registry.js";
import type { AnalyzeInput } from "../idiom-analysis.service.js";
import { analyzeIdiom, analyzeIdiomBatch, needsIdiomReview } from "../idiom-analysis.service.js";
import type { IdiomAnalysisResult } from "../types.js";

describe("analyzeIdiom", () => {
  const mockInput: AnalyzeInput = {
    sourcePhrase: "Break a leg",
    sourceLang: "en",
    translatedPhrase: "Zlom si nohu",
    targetLang: "cs",
    model: "test-model",
    resolveLanguageName: getLanguageName,
  };

  const mockResult: IdiomAnalysisResult = {
    sourceIsIdiomatic: true,
    sourceExpressionType: "idiom",
    sourceLiteralMeaning: "Physically break your leg",
    sourceIntendedMeaning: "Good luck",
    classification: "LITERAL_BUT_UNNATURAL",
    confidence: 0.95,
    toneMatch: false,
    intensityMatch: true,
    explanation: "The Czech translation is literal and sounds unnatural",
    suggestedAlternative: "Zlom vaz",
    alternativeExplanation: "Common Czech idiom meaning good luck",
  };

  it("calls generateObjectFn with correct prompt and schema", async () => {
    const mockGenerateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await analyzeIdiom(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(mockGenerateObjectFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateObjectFn).toHaveBeenCalledWith(
      expect.stringContaining("Break a leg"),
      expect.any(Object), // Zod schema
      "test-model",
    );
  });

  it("returns AI response as result", async () => {
    const mockGenerateObjectFn = vi.fn().mockResolvedValue(mockResult);

    const result = await analyzeIdiom(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(result).toEqual(mockResult);
  });

  it("passes correct input to prompt builder", async () => {
    const mockGenerateObjectFn = vi.fn().mockResolvedValue(mockResult);

    await analyzeIdiom(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn);

    const [prompt] = mockGenerateObjectFn.mock.calls[0];
    expect(prompt).toContain("Break a leg");
    expect(prompt).toContain("English");
    expect(prompt).toContain("Zlom si nohu");
    expect(prompt).toContain("Czech");
  });

  it("propagates errors from generateObjectFn", async () => {
    const mockError = new Error("AI service error");
    const mockGenerateObjectFn = vi.fn().mockRejectedValue(mockError);

    await expect(analyzeIdiom(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn)).rejects.toThrow(
      "AI service error",
    );
  });
});

describe("analyzeIdiomBatch", () => {
  const inputs: AnalyzeInput[] = [
    {
      sourcePhrase: "Break a leg",
      sourceLang: "en",
      translatedPhrase: "Zlom si nohu",
      targetLang: "cs",
      model: "test-model",
    },
    {
      sourcePhrase: "Piece of cake",
      sourceLang: "en",
      translatedPhrase: "Hračka",
      targetLang: "cs",
      model: "test-model",
    },
  ];

  it("processes multiple inputs sequentially", async () => {
    const mockResults: IdiomAnalysisResult[] = [
      {
        sourceIsIdiomatic: true,
        sourceIntendedMeaning: "Good luck",
        classification: "LITERAL_BUT_UNNATURAL",
        confidence: 0.95,
        toneMatch: false,
        intensityMatch: true,
        explanation: "Literal translation",
      },
      {
        sourceIsIdiomatic: true,
        sourceIntendedMeaning: "Something easy",
        classification: "CORRECT_IDIOMATIC_TRANSLATION",
        confidence: 0.9,
        toneMatch: true,
        intensityMatch: true,
        explanation: "Natural translation",
      },
    ];

    let callIndex = 0;
    const mockGenerateObjectFn = vi.fn().mockImplementation(() => {
      return Promise.resolve(mockResults[callIndex++]);
    });

    const results = await analyzeIdiomBatch(inputs, mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(mockGenerateObjectFn).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[0].classification).toBe("LITERAL_BUT_UNNATURAL");
    expect(results[1].classification).toBe("CORRECT_IDIOMATIC_TRANSLATION");
  });

  it("returns empty array for empty input", async () => {
    const mockGenerateObjectFn = vi.fn();

    const results = await analyzeIdiomBatch([], mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(results).toEqual([]);
    expect(mockGenerateObjectFn).not.toHaveBeenCalled();
  });

  it("propagates first error in batch", async () => {
    const mockError = new Error("AI service error");
    const mockGenerateObjectFn = vi.fn().mockRejectedValue(mockError);

    await expect(analyzeIdiomBatch(inputs, mockGenerateObjectFn as unknown as GenerateObjectFn)).rejects.toThrow(
      "AI service error",
    );
  });
});

describe("needsIdiomReview", () => {
  const mockInput: AnalyzeInput = {
    sourcePhrase: "Break a leg",
    sourceLang: "en",
    translatedPhrase: "Zlom si nohu",
    targetLang: "cs",
    model: "test-model",
  };

  it("returns true for LITERAL_BUT_UNNATURAL classification", async () => {
    const mockResult: IdiomAnalysisResult = {
      sourceIsIdiomatic: true,
      sourceIntendedMeaning: "Good luck",
      classification: "LITERAL_BUT_UNNATURAL",
      confidence: 0.95,
      toneMatch: false,
      intensityMatch: true,
      explanation: "Literal translation",
    };
    const mockGenerateObjectFn = vi.fn().mockResolvedValue(mockResult);

    const result = await needsIdiomReview(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(result).toBe(true);
  });

  it("returns true for INCORRECT_MEANING classification", async () => {
    const mockResult: IdiomAnalysisResult = {
      sourceIsIdiomatic: true,
      sourceIntendedMeaning: "Good luck",
      classification: "INCORRECT_MEANING",
      confidence: 0.85,
      toneMatch: false,
      intensityMatch: false,
      explanation: "Wrong meaning",
    };
    const mockGenerateObjectFn = vi.fn().mockResolvedValue(mockResult);

    const result = await needsIdiomReview(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(result).toBe(true);
  });

  it("returns false for CORRECT_IDIOMATIC_TRANSLATION classification", async () => {
    const mockResult: IdiomAnalysisResult = {
      sourceIsIdiomatic: true,
      sourceIntendedMeaning: "Something easy",
      classification: "CORRECT_IDIOMATIC_TRANSLATION",
      confidence: 0.9,
      toneMatch: true,
      intensityMatch: true,
      explanation: "Natural translation",
    };
    const mockGenerateObjectFn = vi.fn().mockResolvedValue(mockResult);

    const result = await needsIdiomReview(mockInput, mockGenerateObjectFn as unknown as GenerateObjectFn);

    expect(result).toBe(false);
  });
});
