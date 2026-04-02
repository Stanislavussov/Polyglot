import { describe, expect, it } from "vitest";
import { liteValidationResultSchema, liteValidationScoreSchema, REVIEW_THRESHOLD } from "../schemas.js";

describe("liteValidationScoreSchema", () => {
  const validScore = {
    meaningPreserved: 4,
    naturalness: 5,
    registerAccuracy: 3,
    cefrAccuracy: 4,
    overallScore: 4,
    reasoning: "Good translation, natural phrasing",
  };

  it("accepts a valid score", () => {
    const result = liteValidationScoreSchema.safeParse(validScore);
    expect(result.success).toBe(true);
  });

  it("accepts minimum scores (all zeros)", () => {
    const result = liteValidationScoreSchema.safeParse({
      meaningPreserved: 0,
      naturalness: 0,
      registerAccuracy: 0,
      cefrAccuracy: 0,
      overallScore: 0,
      reasoning: "Completely wrong",
    });
    expect(result.success).toBe(true);
  });

  it("accepts maximum scores (all fives)", () => {
    const result = liteValidationScoreSchema.safeParse({
      meaningPreserved: 5,
      naturalness: 5,
      registerAccuracy: 5,
      cefrAccuracy: 5,
      overallScore: 5,
      reasoning: "Perfect",
    });
    expect(result.success).toBe(true);
  });

  it("rejects score above 5", () => {
    const result = liteValidationScoreSchema.safeParse({
      ...validScore,
      meaningPreserved: 6,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative score", () => {
    const result = liteValidationScoreSchema.safeParse({
      ...validScore,
      naturalness: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer score", () => {
    const result = liteValidationScoreSchema.safeParse({
      ...validScore,
      overallScore: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty reasoning", () => {
    const result = liteValidationScoreSchema.safeParse({
      ...validScore,
      reasoning: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = liteValidationScoreSchema.safeParse({
      meaningPreserved: 4,
      naturalness: 5,
      // missing registerAccuracy, cefrAccuracy, overallScore, reasoning
    });
    expect(result.success).toBe(false);
  });

  it("rejects string instead of number", () => {
    const result = liteValidationScoreSchema.safeParse({
      ...validScore,
      meaningPreserved: "4",
    });
    expect(result.success).toBe(false);
  });
});

describe("liteValidationResultSchema", () => {
  const validResult = {
    scores: {
      cs: {
        meaningPreserved: 4,
        naturalness: 5,
        registerAccuracy: 3,
        cefrAccuracy: 4,
        overallScore: 4,
        reasoning: "Good Czech translation",
      },
      de: {
        meaningPreserved: 3,
        naturalness: 4,
        registerAccuracy: 4,
        cefrAccuracy: 3,
        overallScore: 3,
        reasoning: "Acceptable German translation",
      },
    },
  };

  it("accepts valid multi-language result", () => {
    const result = liteValidationResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it("accepts single-language result", () => {
    const result = liteValidationResultSchema.safeParse({
      scores: {
        cs: validResult.scores.cs,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty scores (no languages)", () => {
    const result = liteValidationResultSchema.safeParse({ scores: {} });
    expect(result.success).toBe(true);
  });

  it("rejects missing scores field", () => {
    const result = liteValidationResultSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid score in one language", () => {
    const result = liteValidationResultSchema.safeParse({
      scores: {
        cs: { ...validResult.scores.cs, overallScore: 10 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("REVIEW_THRESHOLD", () => {
  it("is set to 3", () => {
    expect(REVIEW_THRESHOLD).toBe(3);
  });
});
