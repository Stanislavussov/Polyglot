/**
 * Tests for translation alternatives support in the topics layer.
 *
 * Verifies that the `alternatives` field (up to 2 additional TranslationVariant
 * entries per language) flows through the topic service correctly — via cache
 * reads, batch translations, partial regeneration, and custom topic generation.
 */
import { describe, expect, it, vi } from "vitest";
import type { TranslateOutput } from "../../translation/types.js";
import { createTopicService, getDataset } from "../topic.service.js";
import type { CachedTranslation, LanguageTranslationEntry, TopicDeps, TopicTranslationVariant } from "../types.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const sampleAlternatives: TopicTranslationVariant[] = [
  {
    text: "alt1",
    synonyms: [{ text: "alt1_syn" }],
  },
  {
    text: "alt2",
    synonyms: [{ text: "alt2_syn" }],
  },
];

function makeTranslateOutputWithAlternatives(original: string, targetLangs: string[]): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      synonyms: [{ text: `syn_${original}_${lang}` }],
      examples: [{ context: "neutral", target: `Example of ${original} in ${lang}.` }],
      alternatives: [
        {
          text: `${original}_alt1_${lang}`,
          synonyms: [{ text: `${original}_alt1_syn_${lang}` }],
        },
        {
          text: `${original}_alt2_${lang}`,
          synonyms: [{ text: `${original}_alt2_syn_${lang}` }],
        },
      ],
    };
  }
  return {
    original,
    sourceLang: "en",
    emoji: "📝",
    nativeSynonyms: [],
    translations: translations as TranslateOutput["translations"],
  };
}

function makeTranslateOutputWithoutAlternatives(original: string, targetLangs: string[]): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      synonyms: [],
      examples: [{ context: "neutral", target: `Example of ${original} in ${lang}.` }],
    };
  }
  return {
    original,
    sourceLang: "en",
    emoji: "📝",
    nativeSynonyms: [],
    translations: translations as TranslateOutput["translations"],
  };
}

function makeCachedTranslationWithAlternatives(
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
      synonyms: [],
      examples: [{ context: "neutral", target: `Cached ${original} in ${targetLang}.` }],
      alternatives: [
        {
          text: `${original}_alt1_${targetLang}_cached`,
          synonyms: [{ text: `cached_syn_1` }],
        },
        {
          text: `${original}_alt2_${targetLang}_cached`,
          synonyms: [],
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
// LanguageTranslationEntry type tests
// ─────────────────────────────────────────────

describe("LanguageTranslationEntry alternatives field", () => {
  it("accepts alternatives as an optional field", () => {
    const entry: LanguageTranslationEntry = {
      text: "apple",
      synonyms: [],
      examples: [],
      alternatives: sampleAlternatives,
    };

    expect(entry.alternatives).toHaveLength(2);
    expect(entry.alternatives![0].text).toBe("alt1");
    expect(entry.alternatives![0].synonyms).toHaveLength(1);
    expect(entry.alternatives![1].text).toBe("alt2");
  });

  it("allows omitting alternatives (backward compatible)", () => {
    const entry: LanguageTranslationEntry = {
      text: "apple",
      synonyms: [],
      examples: [],
    };

    expect(entry.alternatives).toBeUndefined();
  });

  it("allows empty alternatives array", () => {
    const entry: LanguageTranslationEntry = {
      text: "apple",
      synonyms: [],
      examples: [],
      alternatives: [],
    };

    expect(entry.alternatives).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// getTopicWords — alternatives via batch
// ─────────────────────────────────────────────

describe("getTopicWords with alternatives", () => {
  it("preserves alternatives from translateBatch output", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);
    const translateBatch = vi
      .fn()
      .mockResolvedValue(dataset.words.map((w) => makeTranslateOutputWithAlternatives(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    const firstWord = words[0];
    const csTranslation = firstWord.translations.cs;
    expect(csTranslation.alternatives).toHaveLength(2);
    expect(csTranslation.alternatives![0].text).toContain("_alt1_cs");
    expect(csTranslation.alternatives![1].text).toContain("_alt2_cs");
  });

  it("stores alternatives in cache via setCached", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);
    const setCached = vi.fn().mockResolvedValue(undefined);
    const translateBatch = vi
      .fn()
      .mockResolvedValue(dataset.words.map((w) => makeTranslateOutputWithAlternatives(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch, setCached });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    const firstCacheCall = setCached.mock.calls[0][0];
    const cachedContent = firstCacheCall.content as LanguageTranslationEntry;
    expect(cachedContent.alternatives).toHaveLength(2);
  });

  it("retrieves alternatives from cache", async () => {
    const _dataset = getDataset("food")!;
    const getCached = vi
      .fn()
      .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
        Promise.resolve(makeCachedTranslationWithAlternatives(topicId, original, sourceLang, targetLang)),
      );

    const translateBatch = vi.fn();
    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    const firstWord = words[0];
    expect(firstWord.translations.cs.alternatives).toHaveLength(2);
    expect(firstWord.translations.cs.alternatives![0].text).toContain("_alt1_cs_cached");
    expect(firstWord.translations.cs.alternatives![1].text).toContain("_alt2_cs_cached");
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("handles mixed words with and without alternatives", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);

    const translateBatch = vi
      .fn()
      .mockResolvedValue(
        dataset.words.map((w, i) =>
          i === 0 ? makeTranslateOutputWithAlternatives(w, ["cs"]) : makeTranslateOutputWithoutAlternatives(w, ["cs"]),
        ),
      );

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    // First word has alternatives
    expect(words[0].translations.cs.alternatives).toHaveLength(2);
    // Second word has no alternatives
    expect(words[1].translations.cs.alternatives).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// regenerateTopicWord — alternatives
// ─────────────────────────────────────────────

describe("regenerateTopicWord with alternatives", () => {
  const entryWithAlternatives: LanguageTranslationEntry = {
    text: "jablko",
    synonyms: [{ text: "jablíčko" }],
    examples: [{ context: "neutral", target: "Podej mi jablko." }],
    alternatives: [
      {
        text: "jabloň plod",
        synonyms: [{ text: "ovoce" }],
      },
      {
        text: "jablíčko",
        synonyms: [],
      },
    ],
  };

  it("returns alternatives from translateOne", async () => {
    const translateOne = vi.fn().mockResolvedValue(entryWithAlternatives);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const result = await service.regenerateTopicWord("food", word, "en", "cs");

    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives![0].text).toBe("jabloň plod");
    expect(result.alternatives![1].text).toBe("jablíčko");
  });

  it("caches alternatives after regeneration", async () => {
    const translateOne = vi.fn().mockResolvedValue(entryWithAlternatives);
    const setCached = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({ translateOne, setCached });
    const service = createTopicService(deps);

    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    await service.regenerateTopicWord("food", word, "en", "cs");

    const cachedContent = setCached.mock.calls[0][0].content as LanguageTranslationEntry;
    expect(cachedContent.alternatives).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────
// generateCustomTopic — alternatives
// ─────────────────────────────────────────────

describe("generateCustomTopic with alternatives", () => {
  it("preserves alternatives in custom topic words", async () => {
    const generateWords = vi.fn().mockResolvedValue({
      name: "Fruits",
      emoji: "🍎",
      words: ["apple", "banana"],
    });

    const translateBatch = vi
      .fn()
      .mockResolvedValue([
        makeTranslateOutputWithAlternatives("apple", ["cs"]),
        makeTranslateOutputWithAlternatives("banana", ["cs"]),
      ]);

    const deps = createMockDeps({ generateWords, translateBatch });
    const service = createTopicService(deps);

    const topic = await service.generateCustomTopic("fruits", "en", ["cs"]);

    expect(topic.words[0].translations.cs.alternatives).toHaveLength(2);
    expect(topic.words[1].translations.cs.alternatives).toHaveLength(2);
  });
});
