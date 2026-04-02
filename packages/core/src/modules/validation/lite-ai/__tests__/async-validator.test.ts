import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loggerModule from "../../../../logger.js";
import type { LanguageTranslation } from "../../../translation/types.js";
import { triggerAsyncValidation } from "../async-validator.js";
import type { AsyncValidationParams } from "../types.js";

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

/** Good AI response (no flag) */
function goodResponse() {
  return {
    scores: {
      cs: {
        meaningPreserved: 5,
        naturalness: 5,
        registerAccuracy: 5,
        cefrAccuracy: 5,
        overallScore: 5,
        reasoning: "Perfect",
      },
    },
  };
}

/** Bad AI response (flagged) */
function badResponse() {
  return {
    scores: {
      cs: {
        meaningPreserved: 1,
        naturalness: 1,
        registerAccuracy: 1,
        cefrAccuracy: 1,
        overallScore: 1,
        reasoning: "Very poor",
      },
    },
  };
}

/** Helper to flush microtask queue so fire-and-forget promises resolve */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("triggerAsyncValidation", () => {
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

  function makeParams(overrides?: Partial<AsyncValidationParams>): AsyncValidationParams {
    return {
      original: "hello",
      sourceLang: "en",
      translations: { cs: makeTranslation("ahoj") },
      inputType: "phrase", // triggers high-risk (criterion 1)
      dictionaryContext: {
        word: "hello",
        pos: "phrase",
        glosses: ["a greeting"],
        langCode: "en",
      },
      targetLangs: ["cs"],
      validatorModel: "google/gemini-2.5-flash-lite",
      generateObjectFn: vi.fn().mockResolvedValue(goodResponse()),
      onFlagged: vi.fn(),
      ...overrides,
    };
  }

  it("returns immediately when validatorModel is undefined", async () => {
    const params = makeParams({ validatorModel: undefined });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(params.generateObjectFn).not.toHaveBeenCalled();
  });

  it("returns immediately when translation is not high-risk", async () => {
    // All safe: word inputType, dictionary context with non-idiom pos, safe langs, literal expressions
    const params = makeParams({
      inputType: "word",
      dictionaryContext: { word: "hello", pos: "noun", glosses: ["greeting"], langCode: "en" },
      expressionTypes: ["literal"],
      targetLangs: ["en"],
    });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(params.generateObjectFn).not.toHaveBeenCalled();
  });

  it("calls validateWithLiteAI when translation is high-risk", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(goodResponse());
    const params = makeParams({ generateObjectFn: mockGenerate });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(mockGenerate).toHaveBeenCalled();
  });

  it("calls onFlagged when translation is flagged for review", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(badResponse());
    const onFlagged = vi.fn();
    const params = makeParams({ generateObjectFn: mockGenerate, onFlagged });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(onFlagged).toHaveBeenCalledWith(
      expect.objectContaining({
        cs: expect.objectContaining({ overallScore: 1 }),
      }),
    );
  });

  it("does NOT call onFlagged when translation passes", async () => {
    const onFlagged = vi.fn();
    const params = makeParams({ onFlagged });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(onFlagged).not.toHaveBeenCalled();
  });

  it("catches and logs errors without throwing", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("Network failure"));
    const params = makeParams({ generateObjectFn: mockGenerate });

    // Should not throw
    triggerAsyncValidation(params);
    await flushPromises();

    // validateWithLiteAI catches internally and returns graceful result,
    // so the outer catch may or may not fire — either way no throw
    expect(params.onFlagged).not.toHaveBeenCalled();
  });

  it("logs info when async validation starts", async () => {
    const params = makeParams();

    triggerAsyncValidation(params);
    await flushPromises();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        original: "hello",
        isHighRisk: true,
      }),
      expect.stringContaining("async lite validation started"),
    );
  });

  it("triggers for Wiktionary miss (dictionaryContext undefined)", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(goodResponse());
    const params = makeParams({
      inputType: "word",
      dictionaryContext: undefined,
      expressionTypes: ["literal"],
      targetLangs: ["en"],
      generateObjectFn: mockGenerate,
    });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(mockGenerate).toHaveBeenCalled();
  });

  it("triggers for uncommon target language", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(goodResponse());
    const params = makeParams({
      inputType: "word",
      dictionaryContext: { word: "hello", pos: "noun", glosses: ["greeting"], langCode: "en" },
      expressionTypes: ["literal"],
      targetLangs: ["sw"], // Swahili — not in safe list
      generateObjectFn: mockGenerate,
    });

    triggerAsyncValidation(params);
    await flushPromises();

    expect(mockGenerate).toHaveBeenCalled();
  });
});
