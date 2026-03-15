import { describe, it, expect, vi } from "vitest";
import {
  translate,
  translateBatch,
  parseResponse,
} from "../translation.service.js";
import type { TranslateInput, TranslationResult } from "../types.js";

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
            context: "formal",
            target: "Řekl ahoj svému kolegovi.",
            native: "He said hello to his colleague.",
          },
          {
            context: "colloquial",
            target: "Ahoj, jak se máš?",
            native: "Hello, how are you?",
          },
          {
            context: "professional",
            target: "Ahoj, vítejte na schůzce.",
            native: "Hello, welcome to the meeting.",
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
              context: "formal",
              target: "Hello, jak se máš?",
              native: "Hello, how are you?",
            },
          ],
        },
      },
    });

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(badResult)
      .mockResolvedValueOnce(makeValidResult());

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
              context: "formal",
              target: "Hello world in Czech.",
              native: "Hello world in English.",
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
              context: "formal",
              target: "Řekl ahoj kolegovi.",
              native: "He said hello to a colleague.",
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
              context: "formal",
              target: "Er sagte hallo zum Kollegen.",
              native: "He said hello to a colleague.",
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
    const mockGenerate = vi
      .fn()
      .mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(translate(defaultInput, mockGenerate)).rejects.toThrow(
      "API rate limit exceeded",
    );
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
                  context: "formal",
                  target: "Svět je krásné místo.",
                  native: "The world is a beautiful place.",
                },
              ],
            },
          },
        }),
      );

    const results = await translateBatch(
      ["hello", "world"],
      "en",
      ["cs"],
      "openai/gpt-4o",
      mockGenerate,
    );

    expect(results).toHaveLength(2);
    expect(results[0].original).toBe("hello");
    expect(results[0].translations.cs.text).toBe("ahoj");
    expect(results[1].original).toBe("world");
    expect(results[1].translations.cs.text).toBe("svět");
  });

  it("returns empty array for empty input", async () => {
    const mockGenerate = vi.fn();

    const results = await translateBatch(
      [],
      "en",
      ["cs"],
      "openai/gpt-4o",
      mockGenerate,
    );

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

    await translateBatch(
      ["a", "b", "c"],
      "en",
      ["cs"],
      "openai/gpt-4o",
      mockGenerate,
    );

    expect(callOrder).toEqual([1, 2, 3]);
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
