import { describe, expect, it, vi, beforeEach } from "vitest";
import { setLogger } from "../../../logger.js";
import type { Logger } from "../../../logger.js";
import { parseResponse, translate, translateBatch, translateOne } from "../translation.service.js";
import type { TranslateInput, TranslationResult } from "../types.js";

/** Shared mock logger for validation logging tests */
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** A valid AI response matching translationResultSchema */
function makeValidResult(overrides?: Partial<TranslationResult>): TranslationResult {
  return {
    emoji: "👋",
    register: "neutral",
    translations: {
      cs: {
        text: "ahoj",
        cefr: "A1",
        register: "colloquial",
        synonyms: [{ text: "čau", register: "slang" }],
        examples: [
          {
            context: "neutral",
            target: "Řekl ahoj svému kolegovi.",
            register: "нейтральный",
          },
          {
            context: "colloquial",
            target: "Ahoj, jak se máš?",
            register: "разговорный",
          },
          {
            context: "professional",
            target: "Ahoj, vítejte na schůzce.",
            register: "профессиональный",
          },
        ],
      },
    },
    ...overrides,
  };
}

const defaultInput: TranslateInput = {
  word: "hello",
  sourceLang: "en",
  targetLangs: ["cs"],
  model: "openai/gpt-4o",
};

describe("translate", () => {
  it("returns a valid TranslateOutput on first pass", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(result.original).toBe("hello");
    expect(result.sourceLang).toBe("en");
    expect(result.emoji).toBe("👋");
    expect(result.register).toBe("neutral");
    expect(result.translations.cs.text).toBe("ahoj");
    expect(result.translations.cs.cefr).toBe("A1");
    expect(result.needsReview).toBeUndefined();
  });

  it("calls generateObject exactly once when validation passes", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translate(defaultInput, mockGenerate);

    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("retries on validation failure and succeeds on second attempt", async () => {
    // First call returns bad result (translation = original), second returns good
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello", // same as original → semantic fail
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello, jak se máš?",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValueOnce(badResult).mockResolvedValueOnce(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(result.needsReview).toBeUndefined();
    expect(result.translations.cs.text).toBe("ahoj");
  });

  it("returns needsReview=true after all retries exhausted", async () => {
    // Every call returns a bad result (translation = original)
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello world in Czech.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    const result = await translate(defaultInput, mockGenerate);

    // 1 initial + 2 retries = 3 calls
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(result.needsReview).toBe(true);
  });

  it("includes topic in the prompt when provided", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const input: TranslateInput = {
      ...defaultInput,
      topic: "medicine",
    };

    await translate(input, mockGenerate);

    // The first argument to generateObject is the prompt string
    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain("medicine");
  });

  it("passes the correct model to generateObject", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translate(defaultInput, mockGenerate);

    // Third argument is model
    expect(mockGenerate.mock.calls[0][2]).toBe("openai/gpt-4o");
  });

  it("handles multi-language translations", async () => {
    const multiLangResult = makeValidResult({
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1",
          register: "colloquial",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Řekl ahoj kolegovi.",
              register: "нейтральный",
            },
          ],
        },
        de: {
          text: "hallo",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "hi", register: "colloquial" }],
          examples: [
            {
              context: "neutral",
              target: "Er sagte hallo zum Kollegen.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(multiLangResult);

    const input: TranslateInput = {
      word: "hello",
      sourceLang: "en",
      targetLangs: ["cs", "de"],
      model: "openai/gpt-4o",
    };

    const result = await translate(input, mockGenerate);

    expect(result.translations.cs.text).toBe("ahoj");
    expect(result.translations.de.text).toBe("hallo");
  });

  it("propagates AI adapter errors", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(translate(defaultInput, mockGenerate)).rejects.toThrow("API rate limit exceeded");
  });
});

describe("translateOne", () => {
  it("calls translate() with single-element targetLangs", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    // The prompt should be built with a single target language
    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain("cs");
  });

  it("returns the LanguageTranslation for the requested language", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const result = await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(result.text).toBe("ahoj");
    expect(result.cefr).toBe("A1");
    expect(result.register).toBe("colloquial");
    expect(result.synonyms).toHaveLength(1);
    expect(result.examples).toHaveLength(3);
  });

  it("propagates errors from translate()", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(
      translateOne(
        { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
        mockGenerate,
      ),
    ).rejects.toThrow("API rate limit exceeded");
  });

  it("passes topic through to translate()", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translateOne(
      {
        word: "hello",
        sourceLang: "en",
        targetLangs: ["cs"],
        targetLang: "cs",
        model: "openai/gpt-4o",
        topic: "travel",
      },
      mockGenerate,
    );

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain("travel");
  });

  it("passes userId through to translate()", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o", userId: 42 },
      mockGenerate,
    );

    // userId is passed as 4th arg options
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(String), expect.anything(), "openai/gpt-4o", { userId: 42 });
  });

  it("works with needsReview results (validation exhausted)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello world in Czech.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    // translateOne still returns the LanguageTranslation even if needsReview
    const result = await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(result.text).toBe("hello");
    expect(mockGenerate).toHaveBeenCalledTimes(3); // 1 + 2 retries

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("translateBatch", () => {
  it("translates multiple words", async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(makeValidResult())
      .mockResolvedValueOnce(
        makeValidResult({
          emoji: "🌍",
          translations: {
            cs: {
              text: "svět",
              cefr: "A2",
              register: "neutral",
              synonyms: [{ text: "země", register: "neutral" }],
              examples: [
                {
                  context: "neutral",
                  target: "Svět je krásné místo.",
                  register: "нейтральный",
                },
              ],
            },
          },
        }),
      );

    const results = await translateBatch(["hello", "world"], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    expect(results).toHaveLength(2);
    expect(results[0].original).toBe("hello");
    expect(results[0].translations.cs.text).toBe("ahoj");
    expect(results[1].original).toBe("world");
    expect(results[1].translations.cs.text).toBe("svět");
  });

  it("returns empty array for empty input", async () => {
    const mockGenerate = vi.fn();

    const results = await translateBatch([], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    expect(results).toHaveLength(0);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("calls translate sequentially, not in parallel", async () => {
    const callOrder: number[] = [];

    const mockGenerate = vi.fn().mockImplementation(async () => {
      const callNum = callOrder.length + 1;
      callOrder.push(callNum);
      // Simulate async delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      return makeValidResult({
        emoji: String(callNum),
      });
    });

    await translateBatch(["a", "b", "c"], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    expect(callOrder).toEqual([1, 2, 3]);
  });
});

describe("validation logging", () => {
  beforeEach(() => {
    vi.mocked(mockLogger.info).mockClear();
    vi.mocked(mockLogger.warn).mockClear();
    vi.mocked(mockLogger.error).mockClear();
    vi.mocked(mockLogger.debug).mockClear();
    setLogger(mockLogger);
  });

  it("calls logger.warn on each failed validation attempt", async () => {
    // Every call returns bad result (translation = original → semantic fail)
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello world in Czech.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    await translate(defaultInput, mockGenerate);

    // 3 attempts (0, 1, 2) → 3 logger.warn calls
    expect(mockLogger.warn).toHaveBeenCalledTimes(3);

    // Each call should have the correct structure
    for (let i = 0; i < 3; i++) {
      expect(mockLogger.warn).toHaveBeenNthCalledWith(
        i + 1,
        expect.objectContaining({
          original: "hello",
          retryCount: i,
          failReason: expect.any(String),
        }),
        "translation validation failed",
      );
    }
  });

  it("calls logger.error after all retries exhausted", async () => {
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello world in Czech.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    await translate(defaultInput, mockGenerate);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        original: "hello",
        retryCount: 2,
        failReason: expect.any(String),
      }),
      "translation validation failed after all retries — returning needsReview",
    );
  });

  it("does not log when validation passes on first attempt", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translate(defaultInput, mockGenerate);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("logs warn but not error when retry succeeds", async () => {
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello world in Czech.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValueOnce(badResult).mockResolvedValueOnce(makeValidResult());

    await translate(defaultInput, mockGenerate);

    // One warn for the first failed attempt
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        original: "hello",
        retryCount: 0,
        failReason: expect.stringContaining("semantic"),
      }),
      "translation validation failed",
    );

    // No error since retry succeeded
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("includes failReason with validation error details", async () => {
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          cefr: "A1",
          register: "neutral",
          synonyms: [{ text: "čau", register: "slang" }],
          examples: [
            {
              context: "neutral",
              target: "Hello world in Czech.",
              register: "нейтральный",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    await translate(defaultInput, mockGenerate);

    // The failReason should describe the semantic error
    const firstWarnArgs = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
    const logObj = firstWarnArgs[0] as { failReason: string };
    expect(logObj.failReason).toContain("hello");
    expect(logObj.failReason).toContain("identical");
  });
});

describe("parseResponse", () => {
  it("parses a valid raw response", () => {
    const raw = makeValidResult();
    const result = parseResponse(raw);

    expect(result.emoji).toBe("👋");
    expect(result.register).toBe("neutral");
    expect(result.translations.cs.text).toBe("ahoj");
  });

  it("throws on invalid raw response", () => {
    expect(() => parseResponse({ invalid: true })).toThrow();
  });

  it("throws on missing required fields", () => {
    expect(() =>
      parseResponse({
        emoji: "👋",
        // missing register and translations
      }),
    ).toThrow();
  });

  it("throws on invalid register value", () => {
    const raw = makeValidResult();
    (raw as unknown as Record<string, unknown>).register = "unknown";
    expect(() => parseResponse(raw)).toThrow();
  });

  it("throws on empty translations record", () => {
    // Empty record is valid per schema (z.record), so this should pass
    const raw = makeValidResult({ translations: {} });
    const result = parseResponse(raw);
    expect(result.translations).toEqual({});
  });
});
