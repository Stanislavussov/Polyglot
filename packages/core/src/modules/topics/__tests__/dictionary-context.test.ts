/**
 * Tests for Wiktionary dictionary context integration in the topics layer.
 *
 * Verifies that:
 * - lookupDictionaryContext is called for uncached words
 * - Dictionary contexts are passed to translateBatch / translateOne
 * - Lookup errors are handled gracefully (fail-open)
 * - Backward compatibility: no lookupDictionaryContext → no context passed
 * - Cached words skip dictionary lookup
 * - generateCustomTopic also supports dictionary context
 */
import { describe, it, expect, vi } from "vitest";
import { createTopicService, getDataset } from "../topic.service.js";
import type {
  TopicDeps,
  CachedTranslation,
  LanguageTranslationEntry,
} from "../types.js";
import type {
  TranslateOutput,
  DictionaryContext,
} from "../../translation/types.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeDictionaryContext(
  word: string,
  langCode: string = "en",
): DictionaryContext {
  return {
    word,
    pos: "noun",
    glosses: [`A definition of ${word}`],
    formTags: ["canonical"],
    langCode,
  };
}

function makeTranslateOutput(
  original: string,
  targetLangs: string[],
): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      cefr: "A1",
      register: "neutral",
      synonyms: [{ text: `syn_${original}_${lang}`, register: "neutral" }],
      examples: [
        {
          context: "formal",
          target: `Example of ${original} in ${lang}.`,
          native: `Example of ${original} in native.`,
        },
      ],
    };
  }
  return {
    original,
    sourceLang: "en",
    emoji: "📝",
    register: "neutral",
    translations: translations as TranslateOutput["translations"],
  };
}

function makeCachedTranslation(
  topicId: string,
  original: string,
  sourceLang: string,
  targetLang: string,
): CachedTranslation {
  return {
    id: Math.floor(Math.random() * 1000),
    topicId,
    original,
    sourceLang,
    targetLang,
    content: {
      text: `${original}_${targetLang}_cached`,
      cefr: "A1",
      register: "neutral",
      synonyms: [],
      examples: [
        {
          context: "formal",
          target: `Cached ${original} in ${targetLang}.`,
          native: `Cached ${original} in native.`,
        },
      ],
    },
    isValid: true,
    invalidReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockDeps(overrides?: Partial<TopicDeps>): TopicDeps {
  return {
    translateBatch: vi.fn().mockResolvedValue([]),
    getCached: vi.fn().mockResolvedValue(null),
    setCached: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// getTopicWords — dictionary context integration
// ─────────────────────────────────────────────

describe("getTopicWords with dictionary context", () => {
  it("calls lookupDictionaryContext for each uncached word", async () => {
    const dataset = getDataset("food")!;
    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(null);
    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // lookupDictionaryContext should be called for each word
    expect(lookupDictionaryContext).toHaveBeenCalledTimes(
      dataset.words.length,
    );
    // Each call should be with (word, sourceLang)
    expect(lookupDictionaryContext).toHaveBeenCalledWith(
      dataset.words[0],
      "en",
    );
  });

  it("passes dictionary contexts to translateBatch when available", async () => {
    const dataset = getDataset("food")!;

    // Return dictionary context for the first word only
    const firstWordCtx = makeDictionaryContext(dataset.words[0]);
    const lookupDictionaryContext = vi
      .fn()
      .mockImplementation((word: string) =>
        Promise.resolve(
          word === dataset.words[0] ? firstWordCtx : null,
        ),
      );

    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // translateBatch should be called with 4 args (including contexts map)
    expect(translateBatch).toHaveBeenCalledTimes(1);
    const callArgs = translateBatch.mock.calls[0];
    expect(callArgs).toHaveLength(4);

    // 4th argument should be a Map with the first word's context
    const contextsMap = callArgs[3] as Map<string, DictionaryContext>;
    expect(contextsMap).toBeInstanceOf(Map);
    expect(contextsMap.size).toBe(1);
    expect(contextsMap.get(dataset.words[0])).toEqual(firstWordCtx);
  });

  it("does not pass 4th arg when no dictionary contexts found", async () => {
    const dataset = getDataset("food")!;
    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(null);
    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // translateBatch should be called with 3 args (no contexts map)
    expect(translateBatch).toHaveBeenCalledTimes(1);
    const callArgs = translateBatch.mock.calls[0];
    expect(callArgs).toHaveLength(3);
  });

  it("does not call lookupDictionaryContext when dep is not provided", async () => {
    const dataset = getDataset("food")!;
    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    // No lookupDictionaryContext provided
    const deps = createMockDeps({ translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // translateBatch should be called without contexts
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(translateBatch.mock.calls[0]).toHaveLength(3);
  });

  it("skips dictionary lookup for cached words", async () => {
    const dataset = getDataset("food")!;

    // Cache all words
    const getCached = vi.fn().mockImplementation(
      (topicId: string, original: string, sourceLang: string, targetLang: string) =>
        Promise.resolve(
          makeCachedTranslation(topicId, original, sourceLang, targetLang),
        ),
    );

    const lookupDictionaryContext = vi.fn().mockResolvedValue(null);
    const translateBatch = vi.fn();

    const deps = createMockDeps({
      getCached,
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // Everything cached — no dictionary lookups needed
    expect(lookupDictionaryContext).not.toHaveBeenCalled();
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("looks up context only for uncached words (partial cache)", async () => {
    const dataset = getDataset("food")!;
    const cachedWords = new Set(dataset.words.slice(0, 5));
    const uncachedWords = dataset.words.filter((w) => !cachedWords.has(w));

    const getCached = vi.fn().mockImplementation(
      (topicId: string, original: string, sourceLang: string, targetLang: string) =>
        cachedWords.has(original)
          ? Promise.resolve(
              makeCachedTranslation(topicId, original, sourceLang, targetLang),
            )
          : Promise.resolve(null),
    );

    const lookupDictionaryContext = vi.fn().mockResolvedValue(null);
    const translateBatch = vi.fn().mockResolvedValue(
      uncachedWords.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      getCached,
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // lookupDictionaryContext only called for uncached words
    expect(lookupDictionaryContext).toHaveBeenCalledTimes(
      uncachedWords.length,
    );

    // Verify not called for cached words
    const lookedUpWords = lookupDictionaryContext.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    for (const cached of cachedWords) {
      expect(lookedUpWords).not.toContain(cached);
    }
  });

  it("handles lookupDictionaryContext errors gracefully (fail-open)", async () => {
    const dataset = getDataset("food")!;

    // Lookup fails for all words
    const lookupDictionaryContext = vi
      .fn()
      .mockRejectedValue(new Error("DB connection failed"));

    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    // Should not throw — lookup errors are swallowed
    const words = await service.getTopicWords("food", "en", ["cs"]);

    expect(words).toHaveLength(dataset.words.length);
    // translateBatch called without contexts (all lookups failed)
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(translateBatch.mock.calls[0]).toHaveLength(3);
  });

  it("passes multiple dictionary contexts for multiple words", async () => {
    const dataset = getDataset("food")!;

    // Return contexts for first 3 words
    const contextWords = new Set(dataset.words.slice(0, 3));
    const lookupDictionaryContext = vi
      .fn()
      .mockImplementation((word: string) =>
        Promise.resolve(
          contextWords.has(word) ? makeDictionaryContext(word) : null,
        ),
      );

    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    const callArgs = translateBatch.mock.calls[0];
    const contextsMap = callArgs[3] as Map<string, DictionaryContext>;
    expect(contextsMap.size).toBe(3);
    for (const word of contextWords) {
      expect(contextsMap.has(word)).toBe(true);
      expect(contextsMap.get(word)!.word).toBe(word);
    }
  });

  it("passes sourceLang to lookupDictionaryContext", async () => {
    const dataset = getDataset("food")!;
    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(null);
    const translateBatch = vi.fn().mockResolvedValue(
      dataset.words.map((w) => makeTranslateOutput(w, ["cs"])),
    );

    const deps = createMockDeps({
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "ru", ["cs"]);

    // All lookups should use "ru" as the language code
    for (const call of lookupDictionaryContext.mock.calls) {
      expect(call[1]).toBe("ru");
    }
  });
});

// ─────────────────────────────────────────────
// regenerateTopicWord — dictionary context integration
// ─────────────────────────────────────────────

describe("regenerateTopicWord with dictionary context", () => {
  const mockTranslationEntry: LanguageTranslationEntry = {
    text: "jablko",
    cefr: "A1",
    register: "neutral",
    synonyms: [{ text: "jablíčko", register: "colloquial" }],
    examples: [
      {
        context: "formal",
        target: "Podej mi jablko.",
        native: "Give me an apple.",
      },
    ],
  };

  it("calls lookupDictionaryContext before translateOne", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(makeDictionaryContext(word));
    const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);

    const deps = createMockDeps({
      translateOne,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "cs");

    expect(lookupDictionaryContext).toHaveBeenCalledTimes(1);
    expect(lookupDictionaryContext).toHaveBeenCalledWith(word, "en");
  });

  it("passes dictionary context to translateOne when available", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0];
    const ctx = makeDictionaryContext(word);

    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(ctx);
    const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);

    const deps = createMockDeps({
      translateOne,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "cs");

    // translateOne should be called with 4 args including context
    expect(translateOne).toHaveBeenCalledWith(word, "en", "cs", ctx);
  });

  it("does not pass context to translateOne when lookup returns null", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(null);
    const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);

    const deps = createMockDeps({
      translateOne,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "cs");

    // translateOne called with 3 args only (no context)
    expect(translateOne).toHaveBeenCalledWith(word, "en", "cs");
  });

  it("does not call lookupDictionaryContext when dep is not provided", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);

    // No lookupDictionaryContext provided
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "cs");

    // translateOne called with 3 args only
    expect(translateOne).toHaveBeenCalledWith(word, "en", "cs");
  });

  it("handles lookupDictionaryContext error gracefully in regeneration", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const lookupDictionaryContext = vi
      .fn()
      .mockRejectedValue(new Error("DB error"));
    const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);

    const deps = createMockDeps({
      translateOne,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    // Should not throw — lookup error is caught
    const result = await service.regenerateTopicWord(
      "food",
      word,
      "en",
      "cs",
    );

    expect(result).toEqual(mockTranslationEntry);
    // translateOne called without context (lookup failed)
    expect(translateOne).toHaveBeenCalledWith(word, "en", "cs");
  });
});

// ─────────────────────────────────────────────
// generateCustomTopic — dictionary context integration
// ─────────────────────────────────────────────

describe("generateCustomTopic with dictionary context", () => {
  it("looks up dictionary context for generated words", async () => {
    const lookupDictionaryContext = vi
      .fn()
      .mockResolvedValue(null);

    const generateWords = vi.fn().mockResolvedValue({
      name: "Sports",
      emoji: "⚽",
      words: ["football", "basketball", "tennis"],
    });

    const translateBatch = vi.fn().mockResolvedValue([
      makeTranslateOutput("football", ["cs"]),
      makeTranslateOutput("basketball", ["cs"]),
      makeTranslateOutput("tennis", ["cs"]),
    ]);

    const deps = createMockDeps({
      generateWords,
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.generateCustomTopic("sport words", "en", ["cs"]);

    // lookupDictionaryContext called for each generated word
    expect(lookupDictionaryContext).toHaveBeenCalledTimes(3);
    expect(lookupDictionaryContext).toHaveBeenCalledWith("football", "en");
    expect(lookupDictionaryContext).toHaveBeenCalledWith("basketball", "en");
    expect(lookupDictionaryContext).toHaveBeenCalledWith("tennis", "en");
  });

  it("passes dictionary contexts to translateBatch in custom topic", async () => {
    const footballCtx = makeDictionaryContext("football");
    const lookupDictionaryContext = vi
      .fn()
      .mockImplementation((word: string) =>
        Promise.resolve(word === "football" ? footballCtx : null),
      );

    const generateWords = vi.fn().mockResolvedValue({
      name: "Sports",
      emoji: "⚽",
      words: ["football", "basketball"],
    });

    const translateBatch = vi.fn().mockResolvedValue([
      makeTranslateOutput("football", ["cs"]),
      makeTranslateOutput("basketball", ["cs"]),
    ]);

    const deps = createMockDeps({
      generateWords,
      translateBatch,
      lookupDictionaryContext,
    });
    const service = createTopicService(deps);

    await service.generateCustomTopic("sport words", "en", ["cs"]);

    // translateBatch called with contexts map
    expect(translateBatch.mock.calls[0]).toHaveLength(4);
    const contextsMap = translateBatch.mock.calls[0][3] as Map<
      string,
      DictionaryContext
    >;
    expect(contextsMap.size).toBe(1);
    expect(contextsMap.get("football")).toEqual(footballCtx);
  });

  it("works without lookupDictionaryContext in custom topic", async () => {
    const generateWords = vi.fn().mockResolvedValue({
      name: "Sports",
      emoji: "⚽",
      words: ["football"],
    });

    const translateBatch = vi.fn().mockResolvedValue([
      makeTranslateOutput("football", ["cs"]),
    ]);

    // No lookupDictionaryContext
    const deps = createMockDeps({ generateWords, translateBatch });
    const service = createTopicService(deps);

    const topic = await service.generateCustomTopic(
      "sport words",
      "en",
      ["cs"],
    );

    expect(topic.words).toHaveLength(1);
    // translateBatch called without contexts
    expect(translateBatch.mock.calls[0]).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────
// DictionaryContext type shape
// ─────────────────────────────────────────────

describe("DictionaryContext type shape", () => {
  it("has required fields: word, pos, glosses, langCode", () => {
    const ctx: DictionaryContext = {
      word: "что ли",
      pos: "phrase",
      glosses: ["or something, perhaps, maybe"],
      langCode: "ru",
    };

    expect(ctx.word).toBe("что ли");
    expect(ctx.pos).toBe("phrase");
    expect(ctx.glosses).toEqual(["or something, perhaps, maybe"]);
    expect(ctx.langCode).toBe("ru");
  });

  it("accepts optional formTags field", () => {
    const ctx: DictionaryContext = {
      word: "apple",
      pos: "noun",
      glosses: ["A common fruit"],
      langCode: "en",
      formTags: ["canonical", "romanization"],
    };

    expect(ctx.formTags).toEqual(["canonical", "romanization"]);
  });

  it("works without formTags (optional)", () => {
    const ctx: DictionaryContext = {
      word: "apple",
      pos: "noun",
      glosses: ["A common fruit"],
      langCode: "en",
    };

    expect(ctx.formTags).toBeUndefined();
  });
});
