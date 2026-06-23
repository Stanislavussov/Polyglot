import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger.js";
import { setLogger } from "../../../logger.js";
import { parseResponse, sanitizeEmoji, translate, translateBatch, translateOne } from "../translation.service.js";
import { MINIMAL_OUTPUT, SENTENCE_OUTPUT } from "../translation-output.presets.js";
import type { TranslateInput, TranslateOutput, TranslationDecision, TranslationResult } from "../types.js";

function unwrap(d: TranslationDecision): TranslateOutput {
  if (!("output" in d)) throw new Error(`Unexpected needs_clarification: ${d.ambiguity.message}`);
  return d.output;
}

/** Shared mock logger for validation logging tests */
const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** A valid AI response matching translationResultSchema */
function makeValidResult(overrides?: Partial<TranslationResult>): TranslationResult {
  const base: TranslationResult = {
    emoji: "👋",
    nativeMeaning: "A greeting.",
    nativeSynonyms: [{ text: "привет" }],
    translations: {
      cs: {
        text: "ahoj",
        synonyms: [{ text: "čau" }],
        examples: [
          { context: "neutral", target: "Řekl ahoj svému kolegovi." },
          { context: "colloquial", target: "Ahoj, jak se máš?" },
          { context: "professional", target: "Ahoj, vítejte na schůzce." },
        ],
        expressionType: null,
        equivalentNote: null,
        alternatives: null,
        connotationWarning: null,
      },
    },
  };

  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
    translations:
      overrides.translations === undefined
        ? base.translations
        : Object.keys(overrides.translations).length === 0
          ? {}
          : {
              ...base.translations,
              ...Object.fromEntries(
                Object.entries(overrides.translations).map(([lang, translation]) => [
                  lang,
                  {
                    ...base.translations.cs,
                    ...translation,
                  },
                ]),
              ),
            },
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

    expect(result.status).toBe("accepted");
    expect(unwrap(result).original).toBe("hello");
    expect(unwrap(result).sourceLang).toBe("en");
    expect(unwrap(result).emoji).toBe("👋");
    expect(unwrap(result).nativeMeaning).toBeUndefined();
    expect(unwrap(result).translations.cs.text).toBe("ahoj");
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
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello, jak se máš?" }],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValueOnce(badResult).mockResolvedValueOnce(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("accepted");
    expect(unwrap(result).translations.cs.text).toBe("ahoj");
  });

  it("returns needsReview=true after all retries exhausted", async () => {
    // Every call returns a bad result (translation = original)
    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    const result = await translate(defaultInput, mockGenerate);

    // 1 initial + 2 retries = 3 calls
    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("needs_review");
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

  it("returns needs_clarification for an ambiguous numeric date before calling the model", async () => {
    const mockGenerate = vi.fn();

    const result = await translate(
      {
        word: "Let's meet on 06/07 at 5.",
        sourceLang: "en",
        targetLangs: ["de"],
        nativeLang: "ru",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(result.status).toBe("needs_clarification");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("does not hard-code lexical ambiguity for a specific sentence", async () => {
    const sentenceResult: TranslationResult = {
      emoji: "🦆",
      nativeMeaning: "Я видел, как она пригнулась.",
      nativeSynonyms: [],
      translations: {
        ru: {
          text: "Я видел, как она пригнулась.",
          synonyms: [],
          examples: [],
          expressionType: null,
          equivalentNote: null,
          usageNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    };
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(sentenceResult)
      .mockResolvedValueOnce({ issues: [], summary: "No unsupported assumptions detected." });

    const result = await translate(
      {
        word: "I saw her duck.",
        sourceLang: "en",
        targetLangs: ["ru"],
        nativeLang: "cs",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("runs the semantic judge for high-risk sentence translations", async () => {
    const sentenceResult: TranslationResult = {
      emoji: "🪟",
      nativeMeaning: "Вежливая просьба закрыть окно.",
      nativeSynonyms: [{ text: "просьба" }],
      translations: {
        de: {
          text: "Könntest du das Fenster schließen?",
          synonyms: [],
          examples: [],
          expressionType: null,
          equivalentNote: null,
          usageNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    };
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(sentenceResult)
      .mockResolvedValueOnce({ issues: [], summary: "ok" });

    const result = await translate(
      {
        word: "Could you close the window?",
        sourceLang: "en",
        targetLangs: ["de"],
        nativeLang: "ru",
        inputType: "sentence",
        outputConfig: SENTENCE_OUTPUT,
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[1]?.[2]).toBe("google/gemini-2.5-flash");
  });

  it("keeps an ordinary unbacked word on the single-call medium-risk path", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("medium");
      expect(result.quality.judgeResult).toBeUndefined();
    }
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps a dictionary-backed confident word on the low-risk single-call path", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const result = await translate(
      {
        ...defaultInput,
        dictionaryContext: {
          word: "hello",
          pos: "noun",
          glosses: ["a greeting"],
          langCode: "en",
        },
        outputConfig: MINIMAL_OUTPUT,
        detectionConfidence: 0.93,
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("low");
      expect(result.quality.judgeResult).toBeUndefined();
    }
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("runs the semantic judge for phrase translations", async () => {
    const mockGenerate = vi.fn().mockResolvedValueOnce(makeValidResult()).mockResolvedValueOnce({
      issues: [],
      summary: "Phrase meaning, register, and assumptions are acceptable.",
    });

    const result = await translate(
      {
        ...defaultInput,
        word: "break a leg",
        inputType: "phrase",
      },
      mockGenerate,
    );

    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      expect(result.quality.riskLevel).toBe("high");
      expect(result.quality.judgeResult).toEqual({
        issues: [],
        summary: "Phrase meaning, register, and assumptions are acceptable.",
      });
    }
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[1]?.[2]).toBe("google/gemini-2.5-flash");
  });

  it("uses translation-safe generation settings", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translate(defaultInput, mockGenerate);

    expect(mockGenerate.mock.calls[0][3]).toEqual({ frequencyPenalty: 0 });
  });

  it("handles multi-language translations", async () => {
    const multiLangResult = makeValidResult({
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Řekl ahoj kolegovi." }],
        },
        de: {
          text: "hallo",
          synonyms: [{ text: "hi" }],
          examples: [{ context: "neutral", target: "Er sagte hallo zum Kollegen." }],
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

    expect(unwrap(result).translations.cs.text).toBe("ahoj");
    expect(unwrap(result).translations.de.text).toBe("hallo");
  });

  it("preserves source usage for learning-language source words", async () => {
    const sourceUsage = {
      explanation:
        "Так называют насекомое; слово нейтральное и обычно используется в бытовом или биологическом контексте.",
      synonyms: [{ text: "nábožná kudlanka" }],
      examples: [{ context: "nature", target: "Na zahradě seděla kudlanka.", native: "В саду сидел богомол." }],
    };
    const mockGenerate = vi.fn().mockResolvedValue(
      makeValidResult({
        nativeMeaning: "Богомол; название насекомого.",
        sourceUsage,
        nativeSynonyms: [{ text: "богомол" }],
        translations: {
          en: {
            text: "mantis",
            synonyms: [{ text: "praying mantis" }],
            examples: [{ context: "neutral", target: "I saw a mantis.", native: "Я увидел богомола." }],
            expressionType: null,
            equivalentNote: null,
            usageNote: "Нейтральный вариант для постепенного прекращения использования.",
            alternatives: null,
            connotationWarning: null,
          },
        },
      }),
    );

    const result = await translate(
      {
        word: "kudlanka",
        sourceLang: "cs",
        targetLangs: ["en"],
        nativeLang: "ru",
        inputType: "word",
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(unwrap(result).sourceUsage).toEqual(sourceUsage);
    expect(unwrap(result).nativeMeaning).toBe("Богомол; название насекомого.");
  });

  it("retries when a target block connotation warning is written in the target language", async () => {
    const badResult = makeValidResult({
      nativeMeaning: "Постепенно прекратить использование.",
      translations: {
        cs: {
          text: "postupně ukončit",
          synonyms: [{ text: "zrušit postupně" }],
          examples: [
            {
              context: "neutral",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
          expressionType: null,
          equivalentNote: null,
          usageNote: "Разговорный чешский вариант для неформальных ситуаций.",
          alternatives: null,
          connotationWarning: "Výraz je velmi neformální a může znít nezdvořile.",
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    const result = await translate(
      {
        word: "phase out",
        sourceLang: "en",
        targetLangs: ["cs"],
        nativeLang: "ru",
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    expect(mockGenerate).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("needs_review");
  });

  it("accepts phase-out examples without a redundant native field in the native target block", async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(
        makeValidResult({
          nativeMeaning: "Постепенно прекратить использование.",
          sourceUsage: {
            explanation: "Фразовый глагол означает постепенное прекращение использования или производства.",
            synonyms: [{ text: "discontinue" }],
            examples: [
              {
                context: "policy",
                target: "The government will phase out single-use plastics.",
                native: "Правительство постепенно откажется от одноразового пластика.",
              },
            ],
          },
          nativeSynonyms: [{ text: "постепенно отказаться" }],
          translations: {
            cs: {
              text: "postupně ukončit",
              synonyms: [{ text: "postupně vyřadit" }],
              examples: [
                {
                  context: "policy",
                  target: "Vláda chce postupně ukončit používání plastů.",
                  native: "Правительство хочет постепенно отказаться от пластика.",
                },
              ],
              expressionType: null,
              equivalentNote: null,
              usageNote: "Нейтральный чешский вариант для постепенного прекращения использования.",
              alternatives: null,
              connotationWarning: null,
            },
            ru: {
              text: "постепенно отказаться",
              synonyms: [{ text: "постепенно прекратить" }],
              examples: [
                {
                  context: "policy",
                  target: "Правительство хочет постепенно отказаться от пластика.",
                },
              ],
              expressionType: null,
              equivalentNote: null,
              usageNote: "Естественный русский вариант; обычно сочетается с указанием того, от чего отказываются.",
              alternatives: null,
              connotationWarning: null,
            },
          },
        }),
      )
      .mockResolvedValueOnce({ issues: [], summary: "ok" });

    const result = await translate(
      {
        word: "phase out",
        sourceLang: "en",
        targetLangs: ["cs", "ru"],
        nativeLang: "ru",
        inputType: "phrase",
        model: "google/gemini-3.5-flash",
      },
      mockGenerate,
    );

    expect(unwrap(result).translations.cs.examples[0]?.native).toBe(
      "Правительство хочет постепенно отказаться от пластика.",
    );
    expect(unwrap(result).translations.ru.examples[0]?.native).toBeUndefined();
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("propagates AI adapter errors", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(translate(defaultInput, mockGenerate)).rejects.toThrow("API rate limit exceeded");
  });

  it("sanitizes non-emoji string in emoji field to fallback", async () => {
    setLogger(mockLogger);
    const badEmojiResult = makeValidResult({ emoji: "brittle" });
    const mockGenerate = vi.fn().mockResolvedValue(badEmojiResult);

    const result = await translate(defaultInput, mockGenerate);

    expect(unwrap(result).emoji).toBe("🔤");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawEmoji: "brittle", sanitized: "🔤" }),
      expect.stringContaining("non-emoji"),
    );
  });

  it("preserves valid emoji from AI response", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult({ emoji: "💎" }));

    const result = await translate(defaultInput, mockGenerate);

    expect(unwrap(result).emoji).toBe("💎");
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

    expect(unwrap(result).translations.cs?.text).toBe("ahoj");
    expect(unwrap(result).translations.cs?.synonyms).toHaveLength(1);
    expect(unwrap(result).translations.cs?.examples).toHaveLength(3);
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

  it("passes nativeLang and inputType through to translate()", async () => {
    const resultWithNativeExamples = makeValidResult({
      nativeMeaning: "Приветствие.",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [{ text: "čau" }],
          examples: [
            { context: "neutral", target: "Řekl ahoj svému kolegovi.", native: "Он сказал привет коллеге." },
            { context: "colloquial", target: "Ahoj, jak se máš?", native: "Привет, как дела?" },
            {
              context: "professional",
              target: "Ahoj, vítejte na schůzce.",
              native: "Здравствуйте, добро пожаловать на встречу.",
            },
          ],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    const mockGenerate = vi.fn().mockResolvedValue(resultWithNativeExamples);

    await translateOne(
      {
        word: "ahoj",
        sourceLang: "cs",
        targetLangs: ["cs"],
        targetLang: "cs",
        nativeLang: "ru",
        inputType: "word",
        model: "openai/gpt-4o",
      },
      mockGenerate,
    );

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain('"native"');
    expect(prompt).toContain("translation of the target example sentence");
    expect(prompt).toContain("natural same-language paraphrase or concise explanation");
  });

  it("passes userId through to translate()", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o", userId: 42 },
      mockGenerate,
    );

    // userId is passed as 4th arg options
    expect(mockGenerate).toHaveBeenCalledWith(expect.any(String), expect.anything(), "openai/gpt-4o", {
      frequencyPenalty: 0,
      userId: 42,
    });
  });

  it("works with needsReview results (validation exhausted)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badResult = makeValidResult({
      translations: {
        cs: {
          text: "hello",
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    // translateOne still returns the LanguageTranslation even if needsReview
    const result = await translateOne(
      { word: "hello", sourceLang: "en", targetLangs: ["cs"], targetLang: "cs", model: "openai/gpt-4o" },
      mockGenerate,
    );

    expect(result.status).toBe("needs_review");
    expect(unwrap(result).translations.cs?.text).toBe("hello");
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
              synonyms: [{ text: "země" }],
              examples: [{ context: "neutral", target: "Svět je krásné místo." }],
              expressionType: null,
              equivalentNote: null,
              alternatives: null,
              connotationWarning: null,
            },
          },
        }),
      );

    const results = await translateBatch(["hello", "world"], "en", ["cs"], "openai/gpt-4o", mockGenerate);

    expect(results).toHaveLength(2);
    expect(unwrap(results[0]!).original).toBe("hello");
    expect(unwrap(results[0]!).translations.cs?.text).toBe("ahoj");
    expect(unwrap(results[1]!).original).toBe("world");
    expect(unwrap(results[1]!).translations.cs?.text).toBe("svět");
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
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
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
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
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
      "translation validation failed after all retries — returning needs_review",
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
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
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
          synonyms: [{ text: "čau" }],
          examples: [{ context: "neutral", target: "Hello world in Czech." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
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
    expect(result.translations.cs.text).toBe("ahoj");
  });

  it("throws on invalid raw response", () => {
    expect(() => parseResponse({ invalid: true })).toThrow();
  });

  it("throws on missing required fields", () => {
    expect(() =>
      parseResponse({
        emoji: "👋",
        // missing translations
      }),
    ).toThrow();
  });

  it("throws on empty translations record", () => {
    // Empty record is valid per schema (z.record), so this should pass
    const raw = makeValidResult({ translations: {} });
    const result = parseResponse(raw);
    expect(result.translations).toEqual({});
  });
});

describe("sanitizeEmoji", () => {
  it("passes through valid single emoji", () => {
    expect(sanitizeEmoji("👋")).toBe("👋");
    expect(sanitizeEmoji("🔥")).toBe("🔥");
    expect(sanitizeEmoji("💎")).toBe("💎");
  });

  it("passes through ZWJ sequences", () => {
    expect(sanitizeEmoji("👨‍👩‍👧‍👦")).toBe("👨‍👩‍👧‍👦");
  });

  it("passes through flag emoji", () => {
    expect(sanitizeEmoji("🇷🇺")).toBe("🇷🇺");
  });

  it("replaces plain words with fallback", () => {
    expect(sanitizeEmoji("brittle")).toBe("🔤");
    expect(sanitizeEmoji("fragile")).toBe("🔤");
    expect(sanitizeEmoji("hello world")).toBe("🔤");
  });

  it("replaces empty-looking strings with fallback", () => {
    expect(sanitizeEmoji("abc")).toBe("🔤");
  });
});
