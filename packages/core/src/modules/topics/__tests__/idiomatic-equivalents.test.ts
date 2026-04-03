/**
 * Tests for idiomatic equivalent support in the topics layer.
 *
 * Verifies that expressionType and equivalentNote fields flow through
 * the topic service correctly — via cache reads, batch translations,
 * and partial regeneration.
 */
import { describe, expect, it, vi } from "vitest";
import type { TranslateOutput } from "../../translation/types.js";
import { createTopicService, getDataset } from "../topic.service.js";
import type { CachedTranslation, LanguageTranslationEntry, TopicDeps } from "../types.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeIdiomaticTranslateOutput(original: string, targetLangs: string[]): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_equivalent_${lang}`,
      register: "colloquial",
      synonyms: [{ text: `syn_${original}_${lang}`, register: "neutral" }],
      examples: [
        {
          context: "colloquial",
          target: `Idiomatic example of ${original} in ${lang}.`,
          register: "colloquial",
        },
      ],
      expressionType: "idiomatic_equivalent" as const,
      equivalentNote: `No direct equivalent in ${lang}; closest idiom used`,
    };
  }
  return {
    original,
    sourceLang: "en",
    emoji: "🗣️",
    register: "colloquial",
    translations: translations as TranslateOutput["translations"],
  };
}

function makeLiteralTranslateOutput(original: string, targetLangs: string[]): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      register: "neutral",
      synonyms: [],
      examples: [
        {
          context: "neutral",
          target: `Example of ${original} in ${lang}.`,
          register: "neutral",
        },
      ],
      // expressionType defaults to 'literal' or is omitted
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

function makeIdiomaticCachedTranslation(
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
      text: `${original}_equivalent_${targetLang}_cached`,
      register: "colloquial",
      synonyms: [],
      examples: [
        {
          context: "colloquial",
          target: `Cached idiomatic ${original} in ${targetLang}.`,
          register: "colloquial",
        },
      ],
      expressionType: "idiomatic_equivalent",
      equivalentNote: `Cached: no direct equivalent in ${targetLang}`,
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

describe("LanguageTranslationEntry idiomatic fields", () => {
  it("accepts expressionType and equivalentNote as optional fields", () => {
    const entry: LanguageTranslationEntry = {
      text: "Having your cake and eating it too",
      register: "colloquial",
      synonyms: [],
      examples: [],
      expressionType: "idiomatic_equivalent",
      equivalentNote: "Closest English idiom for the Czech proverb",
    };

    expect(entry.expressionType).toBe("idiomatic_equivalent");
    expect(entry.equivalentNote).toBe("Closest English idiom for the Czech proverb");
  });

  it("allows omitting expressionType and equivalentNote (backward compatible)", () => {
    const entry: LanguageTranslationEntry = {
      text: "apple",
      register: "neutral",
      synonyms: [],
      examples: [],
    };

    expect(entry.expressionType).toBeUndefined();
    expect(entry.equivalentNote).toBeUndefined();
  });

  it("accepts literal as expressionType", () => {
    const entry: LanguageTranslationEntry = {
      text: "apple",
      register: "neutral",
      synonyms: [],
      examples: [],
      expressionType: "literal",
    };

    expect(entry.expressionType).toBe("literal");
  });
});

// ─────────────────────────────────────────────
// getTopicWords — idiomatic translations via batch
// ─────────────────────────────────────────────

describe("getTopicWords with idiomatic translations", () => {
  it("preserves expressionType and equivalentNote from translateBatch output", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);
    const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeIdiomaticTranslateOutput(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    const firstWord = words[0];
    expect(firstWord.translations.cs.expressionType).toBe("idiomatic_equivalent");
    expect(firstWord.translations.cs.equivalentNote).toContain("No direct equivalent");
  });

  it("stores idiomatic fields in cache via setCached", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);
    const setCached = vi.fn().mockResolvedValue(undefined);
    const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeIdiomaticTranslateOutput(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch, setCached });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // Verify that the content passed to setCached contains idiomatic fields
    const firstCacheCall = setCached.mock.calls[0][0];
    const cachedContent = firstCacheCall.content as LanguageTranslationEntry;
    expect(cachedContent.expressionType).toBe("idiomatic_equivalent");
    expect(cachedContent.equivalentNote).toBeDefined();
  });

  it("retrieves idiomatic fields from cache", async () => {
    const _dataset = getDataset("food")!;
    const getCached = vi
      .fn()
      .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
        Promise.resolve(makeIdiomaticCachedTranslation(topicId, original, sourceLang, targetLang)),
      );

    const translateBatch = vi.fn();
    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    // All words should come from cache with idiomatic fields intact
    const firstWord = words[0];
    expect(firstWord.translations.cs.expressionType).toBe("idiomatic_equivalent");
    expect(firstWord.translations.cs.equivalentNote).toContain("Cached:");
    // translateBatch should NOT be called
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("handles mixed literal and idiomatic translations", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);

    // First word is idiomatic, rest are literal
    const translateBatch = vi
      .fn()
      .mockResolvedValue(
        dataset.words.map((w, i) =>
          i === 0 ? makeIdiomaticTranslateOutput(w, ["cs"]) : makeLiteralTranslateOutput(w, ["cs"]),
        ),
      );

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    // First word is idiomatic
    expect(words[0].translations.cs.expressionType).toBe("idiomatic_equivalent");
    expect(words[0].translations.cs.equivalentNote).toBeDefined();

    // Second word is literal (no expressionType set)
    expect(words[1].translations.cs.expressionType).toBeUndefined();
    expect(words[1].translations.cs.equivalentNote).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// regenerateTopicWord — idiomatic fields
// ─────────────────────────────────────────────

describe("regenerateTopicWord with idiomatic translations", () => {
  const idiomaticEntry: LanguageTranslationEntry = {
    text: "Avoir le beurre et l'argent du beurre",
    register: "colloquial",
    synonyms: [{ text: "tout avoir", register: "colloquial" }],
    examples: [
      {
        context: "colloquial",
        target: "Il veut avoir le beurre et l'argent du beurre.",
        register: "familier",
      },
    ],
    expressionType: "idiomatic_equivalent",
    equivalentNote: "French equivalent of 'having your cake and eating it too'",
  };

  it("returns idiomatic fields from translateOne", async () => {
    const translateOne = vi.fn().mockResolvedValue(idiomaticEntry);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const result = await service.regenerateTopicWord("food", word, "en", "fr");

    expect(result.expressionType).toBe("idiomatic_equivalent");
    expect(result.equivalentNote).toBe("French equivalent of 'having your cake and eating it too'");
  });

  it("caches idiomatic fields after regeneration", async () => {
    const translateOne = vi.fn().mockResolvedValue(idiomaticEntry);
    const setCached = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({ translateOne, setCached });
    const service = createTopicService(deps);

    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    await service.regenerateTopicWord("food", word, "en", "fr");

    const cachedContent = setCached.mock.calls[0][0].content as LanguageTranslationEntry;
    expect(cachedContent.expressionType).toBe("idiomatic_equivalent");
    expect(cachedContent.equivalentNote).toBe("French equivalent of 'having your cake and eating it too'");
  });
});

// ─────────────────────────────────────────────
// generateCustomTopic — idiomatic fields
// ─────────────────────────────────────────────

describe("generateCustomTopic with idiomatic translations", () => {
  it("preserves idiomatic fields in custom topic words", async () => {
    const generateWords = vi.fn().mockResolvedValue({
      name: "Proverbs",
      emoji: "📜",
      words: ["the early bird catches the worm"],
    });

    const translateBatch = vi
      .fn()
      .mockResolvedValue([makeIdiomaticTranslateOutput("the early bird catches the worm", ["cs"])]);

    const deps = createMockDeps({ generateWords, translateBatch });
    const service = createTopicService(deps);

    const topic = await service.generateCustomTopic("proverbs", "en", ["cs"]);

    expect(topic.words[0].translations.cs.expressionType).toBe("idiomatic_equivalent");
    expect(topic.words[0].translations.cs.equivalentNote).toBeDefined();
  });
});
