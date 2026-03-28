import { describe, expect, it } from "vitest";
import {
  idiomAnalysisResultSchema,
  idiomClassificationSchema,
  sourceExpressionTypeSchema,
} from "../schemas/idiom-analysis.schema.js";

describe("idiomClassificationSchema", () => {
  it("accepts valid classification values", () => {
    expect(idiomClassificationSchema.parse("CORRECT_IDIOMATIC_TRANSLATION")).toBe("CORRECT_IDIOMATIC_TRANSLATION");
    expect(idiomClassificationSchema.parse("LITERAL_BUT_UNNATURAL")).toBe("LITERAL_BUT_UNNATURAL");
    expect(idiomClassificationSchema.parse("INCORRECT_MEANING")).toBe("INCORRECT_MEANING");
  });

  it("rejects invalid classification values", () => {
    expect(() => idiomClassificationSchema.parse("INVALID")).toThrow();
    expect(() => idiomClassificationSchema.parse("")).toThrow();
    expect(() => idiomClassificationSchema.parse(null)).toThrow();
    expect(() => idiomClassificationSchema.parse(123)).toThrow();
  });
});

describe("sourceExpressionTypeSchema", () => {
  it("accepts valid expression types", () => {
    expect(sourceExpressionTypeSchema.parse("idiom")).toBe("idiom");
    expect(sourceExpressionTypeSchema.parse("proverb")).toBe("proverb");
    expect(sourceExpressionTypeSchema.parse("slang")).toBe("slang");
    expect(sourceExpressionTypeSchema.parse("figurative")).toBe("figurative");
    expect(sourceExpressionTypeSchema.parse("fixed_expression")).toBe("fixed_expression");
  });

  it("rejects invalid expression types", () => {
    expect(() => sourceExpressionTypeSchema.parse("unknown")).toThrow();
    expect(() => sourceExpressionTypeSchema.parse("")).toThrow();
  });
});

describe("idiomAnalysisResultSchema", () => {
  const validResult = {
    sourceIsIdiomatic: true,
    sourceExpressionType: "idiom",
    sourceLiteralMeaning: "Break your leg",
    sourceIntendedMeaning: "Good luck",
    classification: "LITERAL_BUT_UNNATURAL",
    confidence: 0.95,
    toneMatch: false,
    intensityMatch: true,
    explanation: "The translation is literal and unnatural in Czech",
    suggestedAlternative: "Zlom vaz",
    alternativeExplanation: "Common Czech idiom for wishing good luck",
  };

  it("accepts valid complete result", () => {
    const result = idiomAnalysisResultSchema.parse(validResult);
    expect(result).toEqual(validResult);
  });

  it("accepts result without optional fields", () => {
    const minimalResult = {
      sourceIsIdiomatic: false,
      sourceIntendedMeaning: "Hello",
      classification: "CORRECT_IDIOMATIC_TRANSLATION",
      confidence: 0.9,
      toneMatch: true,
      intensityMatch: true,
      explanation: "Direct translation is natural",
    };
    const result = idiomAnalysisResultSchema.parse(minimalResult);
    expect(result.sourceExpressionType).toBeUndefined();
    expect(result.sourceLiteralMeaning).toBeUndefined();
    expect(result.suggestedAlternative).toBeUndefined();
    expect(result.alternativeExplanation).toBeUndefined();
  });

  it("validates confidence is between 0 and 1", () => {
    expect(() =>
      idiomAnalysisResultSchema.parse({
        ...validResult,
        confidence: 1.5,
      }),
    ).toThrow();

    expect(() =>
      idiomAnalysisResultSchema.parse({
        ...validResult,
        confidence: -0.1,
      }),
    ).toThrow();

    // Edge cases should work
    expect(idiomAnalysisResultSchema.parse({ ...validResult, confidence: 0 }).confidence).toBe(0);
    expect(idiomAnalysisResultSchema.parse({ ...validResult, confidence: 1 }).confidence).toBe(1);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      idiomAnalysisResultSchema.parse({
        sourceIsIdiomatic: true,
        // missing sourceIntendedMeaning
        classification: "CORRECT_IDIOMATIC_TRANSLATION",
        confidence: 0.9,
        toneMatch: true,
        intensityMatch: true,
        explanation: "Test",
      }),
    ).toThrow();
  });

  it("rejects invalid classification in result", () => {
    expect(() =>
      idiomAnalysisResultSchema.parse({
        ...validResult,
        classification: "INVALID_CLASSIFICATION",
      }),
    ).toThrow();
  });

  it("rejects invalid expression type in result", () => {
    expect(() =>
      idiomAnalysisResultSchema.parse({
        ...validResult,
        sourceExpressionType: "unknown_type",
      }),
    ).toThrow();
  });
});
