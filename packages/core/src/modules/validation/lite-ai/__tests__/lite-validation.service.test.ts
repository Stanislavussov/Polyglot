import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loggerModule from "../../../../logger.js";
import type { LanguageTranslation } from "../../../translation/types.js";
import { validateWithLiteAI } from "../lite-validation.service.js";
import type { LiteValidationInput } from "../types.js";

/** Minimal valid language translation */
function makeTranslation(text: string): LanguageTranslation {
  return {
    text,
    cefr: "A1",
    register: "neutral",
    synonyms: [],
    examples: [],
  };
}

/** Valid score response from AI */
function makeScoreResponse(overrides?: Record<string, unknown>) {
  return {
    scores: {
      cs: {
        meaningPreserved: 4,
        naturalness: 5,
        registerAccuracy: 4,
        cefrAccuracy: 4,
        overallScore: 4,
        reasoning: "Good translation",
        ...overrides,
      },
    },
  };
}

describe("validateWithLiteAI", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  beforeEach(() => {
    vi.spyOn(loggerModule, "getLogger").mockReturnValue(mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const input: LiteValidationInput = {
    original: "hello",
    sourceLang: "en",
    translations: {
      cs: makeTranslation("ahoj"),
    },
  };

  const model = "google/gemini-2.5-flash-lite";

  it("returns scores and flaggedForReview=false for good translations", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse());

    const result = await validateWithLiteAI(input, mockGenerate, model);

    expect(result.flaggedForReview).toBe(false);
    expect(result.scores.cs).toBeDefined();
    expect(result.scores.cs.overallScore).toBe(4);
  });

  it("returns flaggedForReview=true when overallScore < 3", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse({ overallScore: 2, reasoning: "Poor quality" }));

    const result = await validateWithLiteAI(input, mockGenerate, model);

    expect(result.flaggedForReview).toBe(true);
    expect(result.scores.cs.overallScore).toBe(2);
  });

  it("returns flaggedForReview=false when overallScore equals threshold (3)", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse({ overallScore: 3 }));

    const result = await validateWithLiteAI(input, mockGenerate, model);

    expect(result.flaggedForReview).toBe(false);
  });

  it("flags when any language scores below threshold", async () => {
    const multiInput: LiteValidationInput = {
      ...input,
      translations: {
        cs: makeTranslation("ahoj"),
        de: makeTranslation("hallo"),
      },
    };

    const mockGenerate = vi.fn().mockResolvedValue({
      scores: {
        cs: {
          meaningPreserved: 5,
          naturalness: 5,
          registerAccuracy: 5,
          cefrAccuracy: 5,
          overallScore: 5,
          reasoning: "Perfect",
        },
        de: {
          meaningPreserved: 1,
          naturalness: 1,
          registerAccuracy: 1,
          cefrAccuracy: 1,
          overallScore: 1,
          reasoning: "Very bad",
        },
      },
    });

    const result = await validateWithLiteAI(multiInput, mockGenerate, model);

    expect(result.flaggedForReview).toBe(true);
  });

  it("passes maxRetries: 0 to generateObjectFn", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse());

    await validateWithLiteAI(input, mockGenerate, model);

    expect(mockGenerate).toHaveBeenCalledWith(expect.any(String), expect.anything(), model, { maxRetries: 0 });
  });

  it("returns graceful empty result on AI failure", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("AI timeout"));

    const result = await validateWithLiteAI(input, mockGenerate, model);

    expect(result.scores).toEqual({});
    expect(result.flaggedForReview).toBe(false);
  });

  it("logs info on successful validation", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse());

    await validateWithLiteAI(input, mockGenerate, model);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        original: "hello",
        sourceLang: "en",
        flaggedForReview: false,
        validatorModel: model,
      }),
      expect.stringContaining("lite validation completed"),
    );
  });

  it("logs warn when flagged for review", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse({ overallScore: 1 }));

    await validateWithLiteAI(input, mockGenerate, model);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        flaggedForReview: true,
      }),
      expect.stringContaining("flagged"),
    );
  });

  it("logs error on AI failure", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("Connection refused"));

    await validateWithLiteAI(input, mockGenerate, model);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Connection refused",
      }),
      expect.stringContaining("failed"),
    );
  });

  it("includes latencyMs in log output", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse());

    await validateWithLiteAI(input, mockGenerate, model);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        latencyMs: expect.any(Number),
      }),
      expect.any(String),
    );
  });

  it("includes overallScores map in log output", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeScoreResponse());

    await validateWithLiteAI(input, mockGenerate, model);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        overallScores: { cs: 4 },
      }),
      expect.any(String),
    );
  });
});
