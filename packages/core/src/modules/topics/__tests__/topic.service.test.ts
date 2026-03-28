import { describe, expect, it, vi } from "vitest";
import { MINIMAL_OUTPUT } from "../../translation/translation-output.presets.js";
import type { TranslateOutput } from "../../translation/types.js";
import { createTopicService, getBuiltinTopics, getDataset } from "../topic.service.js";
import type { CachedTranslation, LanguageTranslationEntry, TopicDeps } from "../types.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeTranslateOutput(original: string, targetLangs: string[]): TranslateOutput {
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
// getBuiltinTopics
// ─────────────────────────────────────────────

describe("getBuiltinTopics", () => {
  it("returns metadata for all built-in topics", () => {
    const topics = getBuiltinTopics();

    expect(topics).toHaveLength(3);
    expect(topics.map((t) => t.id)).toEqual(expect.arrayContaining(["food", "travel", "it-terms"]));
  });

  it("each topic has id, name, emoji, and wordCount", () => {
    const topics = getBuiltinTopics();

    for (const topic of topics) {
      expect(topic.id).toBeTruthy();
      expect(topic.name).toBeTruthy();
      expect(topic.emoji).toBeTruthy();
      expect(topic.wordCount).toBeGreaterThan(0);
    }
  });

  it("returns correct metadata for food topic", () => {
    const topics = getBuiltinTopics();
    const food = topics.find((t) => t.id === "food");

    expect(food).toBeDefined();
    expect(food!.name).toBe("Food & Cooking");
    expect(food!.emoji).toBe("🍳");
    expect(food!.wordCount).toBe(25);
  });

  it("returns correct metadata for travel topic", () => {
    const topics = getBuiltinTopics();
    const travel = topics.find((t) => t.id === "travel");

    expect(travel).toBeDefined();
    expect(travel!.name).toBe("Travel & Transport");
    expect(travel!.emoji).toBe("✈️");
    expect(travel!.wordCount).toBe(25);
  });

  it("returns correct metadata for it-terms topic", () => {
    const topics = getBuiltinTopics();
    const it = topics.find((t) => t.id === "it-terms");

    expect(it).toBeDefined();
    expect(it!.name).toBe("IT & Technology");
    expect(it!.emoji).toBe("💻");
    expect(it!.wordCount).toBe(25);
  });

  it("returns the same reference on repeated calls (loaded once)", () => {
    const topics1 = getBuiltinTopics();
    const topics2 = getBuiltinTopics();

    // Same data, same IDs (datasets loaded once)
    expect(topics1.map((t) => t.id)).toEqual(topics2.map((t) => t.id));
  });
});

// ─────────────────────────────────────────────
// getDataset
// ─────────────────────────────────────────────

describe("getDataset", () => {
  it("returns dataset for a valid topic ID", () => {
    const dataset = getDataset("food");

    expect(dataset).toBeDefined();
    expect(dataset!.id).toBe("food");
    expect(dataset!.words).toBeInstanceOf(Array);
    expect(dataset!.words.length).toBeGreaterThan(0);
  });

  it("returns undefined for an unknown topic ID", () => {
    const dataset = getDataset("nonexistent");

    expect(dataset).toBeUndefined();
  });

  it("dataset words are strings", () => {
    const dataset = getDataset("food");

    for (const word of dataset!.words) {
      expect(typeof word).toBe("string");
      expect(word.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────
// createTopicService
// ─────────────────────────────────────────────

describe("createTopicService", () => {
  // ─────────────────────────────────────────
  // getTopicWords
  // ─────────────────────────────────────────

  describe("getTopicWords", () => {
    it("throws for unknown topic ID", async () => {
      const deps = createMockDeps();
      const service = createTopicService(deps);

      await expect(service.getTopicWords("nonexistent", "en", ["cs"])).rejects.toThrow(
        'Topic not found: "nonexistent"',
      );
    });

    it("checks cache before calling translateBatch", async () => {
      const getCached = vi.fn().mockResolvedValue(null);
      const translateBatch = vi.fn().mockResolvedValue(
        // Return TranslateOutput for each word in food dataset
        Array.from({ length: 25 }, (_, i) => makeTranslateOutput(`word_${i}`, ["cs"])),
      );

      const deps = createMockDeps({ getCached, translateBatch });
      const service = createTopicService(deps);

      // Mock translateBatch to return proper results for actual words
      const dataset = getDataset("food")!;
      translateBatch.mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs"])));

      await service.getTopicWords("food", "en", ["cs"]);

      // getCached should have been called for each word
      expect(getCached).toHaveBeenCalled();
      // translateBatch called with uncached words
      expect(translateBatch).toHaveBeenCalledTimes(1);
    });

    it("uses cached translations when all langs are cached", async () => {
      const dataset = getDataset("food")!;
      const getCached = vi
        .fn()
        .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
          Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang)),
        );

      const translateBatch = vi.fn();
      const deps = createMockDeps({ getCached, translateBatch });
      const service = createTopicService(deps);

      const words = await service.getTopicWords("food", "en", ["cs"]);

      // All words should come from cache
      expect(words).toHaveLength(dataset.words.length);
      // translateBatch should NOT be called — everything was cached
      expect(translateBatch).not.toHaveBeenCalled();
    });

    it("batch translates uncached words", async () => {
      const dataset = getDataset("food")!;

      // Cache first 5 words only
      const cachedWords = new Set(dataset.words.slice(0, 5));
      const getCached = vi
        .fn()
        .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) => {
          if (cachedWords.has(original)) {
            return Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang));
          }
          return Promise.resolve(null);
        });

      const uncachedWords = dataset.words.filter((w) => !cachedWords.has(w));
      const translateBatch = vi.fn().mockResolvedValue(uncachedWords.map((w) => makeTranslateOutput(w, ["cs"])));

      const setCached = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ getCached, translateBatch, setCached });
      const service = createTopicService(deps);

      const words = await service.getTopicWords("food", "en", ["cs"]);

      // All words returned
      expect(words).toHaveLength(dataset.words.length);

      // translateBatch called with only uncached words + MINIMAL_OUTPUT
      expect(translateBatch).toHaveBeenCalledTimes(1);
      expect(translateBatch).toHaveBeenCalledWith(uncachedWords, "en", ["cs"], MINIMAL_OUTPUT);

      // setCached called for each translated word × each target lang
      expect(setCached).toHaveBeenCalledTimes(uncachedWords.length);
    });

    it("stores translations in cache after batch translation", async () => {
      // Only 2 words, all uncached
      const getCached = vi.fn().mockResolvedValue(null);
      const setCached = vi.fn().mockResolvedValue(undefined);

      const dataset = getDataset("food")!;
      const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs", "de"])));

      const deps = createMockDeps({ getCached, translateBatch, setCached });
      const service = createTopicService(deps);

      await service.getTopicWords("food", "en", ["cs", "de"]);

      // setCached called for each word × 2 target langs
      expect(setCached).toHaveBeenCalledTimes(dataset.words.length * 2);

      // Verify cache entry structure
      const firstCall = setCached.mock.calls[0][0];
      expect(firstCall).toHaveProperty("topicId", "food");
      expect(firstCall).toHaveProperty("original");
      expect(firstCall).toHaveProperty("sourceLang", "en");
      expect(firstCall).toHaveProperty("targetLang");
      expect(firstCall).toHaveProperty("content");
    });

    it("preserves dataset word order in output", async () => {
      const dataset = getDataset("food")!;

      // All uncached
      const getCached = vi.fn().mockResolvedValue(null);
      const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs"])));

      const deps = createMockDeps({ getCached, translateBatch });
      const service = createTopicService(deps);

      const words = await service.getTopicWords("food", "en", ["cs"]);

      expect(words.map((w) => w.original)).toEqual(dataset.words);
    });

    it("handles multiple target languages", async () => {
      const getCached = vi.fn().mockResolvedValue(null);

      const dataset = getDataset("food")!;
      const targetLangs = ["cs", "de", "es"];
      const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, targetLangs)));

      const deps = createMockDeps({ getCached, translateBatch });
      const service = createTopicService(deps);

      const words = await service.getTopicWords("food", "en", targetLangs);

      expect(words[0].translations).toHaveProperty("cs");
      expect(words[0].translations).toHaveProperty("de");
      expect(words[0].translations).toHaveProperty("es");
    });

    it("marks word as uncached if ANY target lang is missing from cache", async () => {
      const dataset = getDataset("food")!;

      // Cache only "cs" for the first word, "de" is missing
      const getCached = vi
        .fn()
        .mockImplementation((_topicId: string, original: string, _sourceLang: string, targetLang: string) => {
          if (original === dataset.words[0] && targetLang === "cs") {
            return Promise.resolve(makeCachedTranslation("food", original, "en", "cs"));
          }
          return Promise.resolve(null);
        });

      const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs", "de"])));

      const deps = createMockDeps({ getCached, translateBatch });
      const service = createTopicService(deps);

      await service.getTopicWords("food", "en", ["cs", "de"]);

      // ALL words should be in the batch since the first word has partial cache
      // and the rest have no cache
      expect(translateBatch).toHaveBeenCalledTimes(1);
      const batchWords = translateBatch.mock.calls[0][0] as string[];
      expect(batchWords).toContain(dataset.words[0]);
    });
  });

  // ─────────────────────────────────────────
  // generateCustomTopic
  // ─────────────────────────────────────────

  describe("generateCustomTopic", () => {
    it("throws when generateWords dependency is not provided", async () => {
      const deps = createMockDeps();
      // Remove generateWords
      delete deps.generateWords;
      const service = createTopicService(deps);

      await expect(service.generateCustomTopic("sport words", "en", ["cs"])).rejects.toThrow(
        "generateWords dependency is required",
      );
    });

    it("generates a custom topic with AI-generated words", async () => {
      const generateWords = vi.fn().mockResolvedValue({
        name: "Sports",
        emoji: "⚽",
        words: ["football", "basketball", "tennis"],
      });

      const translateBatch = vi
        .fn()
        .mockResolvedValue([
          makeTranslateOutput("football", ["cs"]),
          makeTranslateOutput("basketball", ["cs"]),
          makeTranslateOutput("tennis", ["cs"]),
        ]);

      const deps = createMockDeps({ generateWords, translateBatch });
      const service = createTopicService(deps);

      const topic = await service.generateCustomTopic("sport words", "en", ["cs"]);

      expect(topic.meta.name).toBe("Sports");
      expect(topic.meta.emoji).toBe("⚽");
      expect(topic.meta.wordCount).toBe(3);
      expect(topic.meta.id).toMatch(/^custom-/);
      expect(topic.words).toHaveLength(3);
      expect(topic.words[0].original).toBe("football");
    });

    it("calls translateBatch with generated words", async () => {
      const generateWords = vi.fn().mockResolvedValue({
        name: "Animals",
        emoji: "🐕",
        words: ["dog", "cat"],
      });

      const translateBatch = vi
        .fn()
        .mockResolvedValue([makeTranslateOutput("dog", ["cs", "de"]), makeTranslateOutput("cat", ["cs", "de"])]);

      const deps = createMockDeps({ generateWords, translateBatch });
      const service = createTopicService(deps);

      await service.generateCustomTopic("animals", "en", ["cs", "de"]);

      expect(translateBatch).toHaveBeenCalledWith(["dog", "cat"], "en", ["cs", "de"], MINIMAL_OUTPUT);
    });

    it("passes prompt to generateWords", async () => {
      const generateWords = vi.fn().mockResolvedValue({
        name: "Test",
        emoji: "🧪",
        words: ["test"],
      });

      const translateBatch = vi.fn().mockResolvedValue([makeTranslateOutput("test", ["cs"])]);

      const deps = createMockDeps({ generateWords, translateBatch });
      const service = createTopicService(deps);

      await service.generateCustomTopic("20 words about chemistry", "en", ["cs"]);

      expect(generateWords).toHaveBeenCalledWith("20 words about chemistry");
    });
  });

  // ─────────────────────────────────────────
  // getCacheStatus
  // ─────────────────────────────────────────

  describe("getCacheStatus", () => {
    it("throws for unknown topic ID", async () => {
      const deps = createMockDeps();
      const service = createTopicService(deps);

      await expect(service.getCacheStatus("nonexistent", "en", ["cs"])).rejects.toThrow(
        'Topic not found: "nonexistent"',
      );
    });

    it("returns 'miss' when nothing is cached", async () => {
      const getCached = vi.fn().mockResolvedValue(null);
      const deps = createMockDeps({ getCached });
      const service = createTopicService(deps);

      const status = await service.getCacheStatus("food", "en", ["cs"]);

      expect(status.status).toBe("miss");
      expect(status.total).toBe(25);
      expect(status.cached).toBe(0);
      expect(status.missing).toBe(25);
    });

    it("returns 'hit' when everything is cached", async () => {
      const getCached = vi
        .fn()
        .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
          Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang)),
        );

      const deps = createMockDeps({ getCached });
      const service = createTopicService(deps);

      const status = await service.getCacheStatus("food", "en", ["cs"]);

      expect(status.status).toBe("hit");
      expect(status.total).toBe(25);
      expect(status.cached).toBe(25);
      expect(status.missing).toBe(0);
    });

    it("returns 'partial' when some words are cached", async () => {
      const dataset = getDataset("food")!;
      const cachedWords = new Set(dataset.words.slice(0, 10));

      const getCached = vi
        .fn()
        .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) => {
          if (cachedWords.has(original)) {
            return Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang));
          }
          return Promise.resolve(null);
        });

      const deps = createMockDeps({ getCached });
      const service = createTopicService(deps);

      const status = await service.getCacheStatus("food", "en", ["cs"]);

      expect(status.status).toBe("partial");
      expect(status.total).toBe(25);
      expect(status.cached).toBe(10);
      expect(status.missing).toBe(15);
    });

    it("checks all target languages for cache hit", async () => {
      const dataset = getDataset("food")!;

      // Cache "cs" for first word, but not "de"
      const getCached = vi
        .fn()
        .mockImplementation((_topicId: string, original: string, _sourceLang: string, targetLang: string) => {
          if (original === dataset.words[0] && targetLang === "cs") {
            return Promise.resolve(makeCachedTranslation("food", original, "en", "cs"));
          }
          return Promise.resolve(null);
        });

      const deps = createMockDeps({ getCached });
      const service = createTopicService(deps);

      const status = await service.getCacheStatus("food", "en", ["cs", "de"]);

      // First word has cs but not de → not fully cached
      expect(status.cached).toBe(0);
      expect(status.status).toBe("miss");
    });

    it("counts word as cached only when ALL target langs are cached", async () => {
      const dataset = getDataset("food")!;

      // Cache both langs for first 5 words
      const cachedWords = new Set(dataset.words.slice(0, 5));
      const getCached = vi
        .fn()
        .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) => {
          if (cachedWords.has(original)) {
            return Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang));
          }
          return Promise.resolve(null);
        });

      const deps = createMockDeps({ getCached });
      const service = createTopicService(deps);

      const status = await service.getCacheStatus("food", "en", ["cs", "de"]);

      expect(status.cached).toBe(5);
      expect(status.missing).toBe(20);
      expect(status.status).toBe("partial");
    });
  });

  // ─────────────────────────────────────────
  // regenerateTopicWord
  // ─────────────────────────────────────────

  describe("regenerateTopicWord", () => {
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

    it("throws for unknown topic ID", async () => {
      const deps = createMockDeps();
      const service = createTopicService(deps);

      await expect(service.regenerateTopicWord("nonexistent", "apple", "en", "cs")).rejects.toThrow(
        'Topic not found: "nonexistent"',
      );
    });

    it("throws when word is not in the dataset", async () => {
      const deps = createMockDeps();
      const service = createTopicService(deps);

      await expect(service.regenerateTopicWord("food", "quantum", "en", "cs")).rejects.toThrow(
        'Word "quantum" not found in topic "food"',
      );
    });

    it("throws when translateOne dependency is not provided", async () => {
      const deps = createMockDeps();
      // translateOne is undefined by default
      const service = createTopicService(deps);

      const dataset = getDataset("food")!;
      const word = dataset.words[0];

      await expect(service.regenerateTopicWord("food", word, "en", "cs")).rejects.toThrow(
        "translateOne dependency is required for partial regeneration",
      );
    });

    it("calls translateOne with correct arguments", async () => {
      const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);
      const deps = createMockDeps({ translateOne });
      const service = createTopicService(deps);

      const dataset = getDataset("food")!;
      const word = dataset.words[0];

      await service.regenerateTopicWord("food", word, "en", "cs");

      expect(translateOne).toHaveBeenCalledTimes(1);
      expect(translateOne).toHaveBeenCalledWith(word, "en", "cs", MINIMAL_OUTPUT);
    });

    it("updates cache with new translation", async () => {
      const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);
      const setCached = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ translateOne, setCached });
      const service = createTopicService(deps);

      const dataset = getDataset("food")!;
      const word = dataset.words[0];

      await service.regenerateTopicWord("food", word, "en", "cs");

      expect(setCached).toHaveBeenCalledTimes(1);
      expect(setCached).toHaveBeenCalledWith({
        topicId: "food",
        original: word,
        sourceLang: "en",
        targetLang: "cs",
        content: mockTranslationEntry,
      });
    });

    it("returns the new LanguageTranslationEntry", async () => {
      const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);
      const deps = createMockDeps({ translateOne });
      const service = createTopicService(deps);

      const dataset = getDataset("food")!;
      const word = dataset.words[0];

      const result = await service.regenerateTopicWord("food", word, "en", "cs");

      expect(result).toEqual(mockTranslationEntry);
      expect(result.text).toBe("jablko");
      expect(result.cefr).toBe("A1");
    });

    it("propagates errors from translateOne", async () => {
      const translateOne = vi.fn().mockRejectedValue(new Error("AI provider timeout"));
      const deps = createMockDeps({ translateOne });
      const service = createTopicService(deps);

      const dataset = getDataset("food")!;
      const word = dataset.words[0];

      await expect(service.regenerateTopicWord("food", word, "en", "cs")).rejects.toThrow("AI provider timeout");
    });

    it("does not call setCached when translateOne fails", async () => {
      const translateOne = vi.fn().mockRejectedValue(new Error("AI error"));
      const setCached = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ translateOne, setCached });
      const service = createTopicService(deps);

      const dataset = getDataset("food")!;
      const word = dataset.words[0];

      await expect(service.regenerateTopicWord("food", word, "en", "cs")).rejects.toThrow();

      expect(setCached).not.toHaveBeenCalled();
    });

    it("works with different topics", async () => {
      const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);
      const setCached = vi.fn().mockResolvedValue(undefined);
      const deps = createMockDeps({ translateOne, setCached });
      const service = createTopicService(deps);

      const dataset = getDataset("travel")!;
      const word = dataset.words[0];

      const result = await service.regenerateTopicWord("travel", word, "en", "de");

      expect(result).toEqual(mockTranslationEntry);
      expect(setCached).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: "travel",
          original: word,
          targetLang: "de",
        }),
      );
    });

    it("works with it-terms topic", async () => {
      const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);
      const deps = createMockDeps({ translateOne });
      const service = createTopicService(deps);

      const dataset = getDataset("it-terms")!;
      const word = dataset.words[0];

      const result = await service.regenerateTopicWord("it-terms", word, "en", "cs");

      expect(result).toEqual(mockTranslationEntry);
    });
  });
});
