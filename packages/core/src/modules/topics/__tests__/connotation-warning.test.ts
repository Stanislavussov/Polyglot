/**
 * Tests for connotationWarning support in the topics layer.
 *
 * Verifies that the optional connotationWarning field flows through
 * the topic service correctly — via cache reads, batch translations,
 * partial regeneration, and custom topic generation.
 */
import { describe, expect, it, vi } from "vitest";
import type { TranslateOutput } from "../../translation/types.js";
import { createTopicService, getDataset } from "../topic.service.js";
import type { CachedTranslation, LanguageTranslationEntry, TopicDeps } from "../types.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeTranslateOutputWithWarning(original: string, targetLangs: string[]): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      cefr: "B1",
      register: "neutral",
      synonyms: [{ text: `syn_${original}_${lang}`, register: "neutral" }],
      examples: [
        {
          context: "neutral",
          target: `Example of ${original} in ${lang}.`,
          register: "neutral",
        },
      ],
      connotationWarning: `to arouse — sexual connotation in ${lang}`,
    };
  }
  return {
    original,
    sourceLang: "en",
    emoji: "⚡",
    register: "neutral",
    translations: translations as TranslateOutput["translations"],
  };
}

function makeTranslateOutputWithoutWarning(original: string, targetLangs: string[]): TranslateOutput {
  const translations: Record<string, unknown> = {};
  for (const lang of targetLangs) {
    translations[lang] = {
      text: `${original}_${lang}`,
      cefr: "A1",
      register: "neutral",
      synonyms: [],
      examples: [
        {
          context: "neutral",
          target: `Example of ${original} in ${lang}.`,
          register: "neutral",
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

function makeCachedTranslationWithWarning(
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
      cefr: "B1",
      register: "neutral",
      synonyms: [],
      examples: [
        {
          context: "neutral",
          target: `Cached ${original} in ${targetLang}.`,
          register: "neutral",
        },
      ],
      connotationWarning: `Cached warning for ${original} in ${targetLang}`,
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

describe("LanguageTranslationEntry connotationWarning field", () => {
  it("accepts connotationWarning as an optional field", () => {
    const entry: LanguageTranslationEntry = {
      text: "to excite",
      cefr: "B1",
      register: "neutral",
      synonyms: [],
      examples: [],
      connotationWarning: "to arouse — sexual connotation",
    };

    expect(entry.connotationWarning).toBe("to arouse — sexual connotation");
  });

  it("allows omitting connotationWarning (backward compatible)", () => {
    const entry: LanguageTranslationEntry = {
      text: "apple",
      cefr: "A1",
      register: "neutral",
      synonyms: [],
      examples: [],
    };

    expect(entry.connotationWarning).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// getTopicWords — connotationWarning via batch
// ─────────────────────────────────────────────

describe("getTopicWords with connotationWarning", () => {
  it("preserves connotationWarning from translateBatch output", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);
    const translateBatch = vi
      .fn()
      .mockResolvedValue(dataset.words.map((w) => makeTranslateOutputWithWarning(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    const firstWord = words[0];
    expect(firstWord.translations.cs.connotationWarning).toContain("sexual connotation");
  });

  it("stores connotationWarning in cache via setCached", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);
    const setCached = vi.fn().mockResolvedValue(undefined);
    const translateBatch = vi
      .fn()
      .mockResolvedValue(dataset.words.map((w) => makeTranslateOutputWithWarning(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch, setCached });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    const firstCacheCall = setCached.mock.calls[0][0];
    const cachedContent = firstCacheCall.content as LanguageTranslationEntry;
    expect(cachedContent.connotationWarning).toBeDefined();
    expect(cachedContent.connotationWarning).toContain("sexual connotation");
  });

  it("retrieves connotationWarning from cache", async () => {
    const _dataset = getDataset("food")!;
    const getCached = vi
      .fn()
      .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
        Promise.resolve(makeCachedTranslationWithWarning(topicId, original, sourceLang, targetLang)),
      );

    const translateBatch = vi.fn();
    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    const firstWord = words[0];
    expect(firstWord.translations.cs.connotationWarning).toContain("Cached warning");
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("handles mixed words with and without connotationWarning", async () => {
    const dataset = getDataset("food")!;
    const getCached = vi.fn().mockResolvedValue(null);

    const translateBatch = vi
      .fn()
      .mockResolvedValue(
        dataset.words.map((w, i) =>
          i === 0 ? makeTranslateOutputWithWarning(w, ["cs"]) : makeTranslateOutputWithoutWarning(w, ["cs"]),
        ),
      );

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    const words = await service.getTopicWords("food", "en", ["cs"]);

    // First word has connotation warning
    expect(words[0].translations.cs.connotationWarning).toBeDefined();
    // Second word has no connotation warning
    expect(words[1].translations.cs.connotationWarning).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// regenerateTopicWord — connotationWarning
// ─────────────────────────────────────────────

describe("regenerateTopicWord with connotationWarning", () => {
  const entryWithWarning: LanguageTranslationEntry = {
    text: "vzrušit",
    cefr: "B1",
    register: "neutral",
    synonyms: [{ text: "podnítit", register: "literary" }],
    examples: [
      {
        context: "neutral",
        target: "Zpráva vzrušila veřejnost.",
        register: "neutrální",
      },
    ],
    connotationWarning: "vzrušit — sexual connotation in some contexts",
  };

  it("returns connotationWarning from translateOne", async () => {
    const translateOne = vi.fn().mockResolvedValue(entryWithWarning);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    const result = await service.regenerateTopicWord("food", word, "en", "cs");

    expect(result.connotationWarning).toBe("vzrušit — sexual connotation in some contexts");
  });

  it("caches connotationWarning after regeneration", async () => {
    const translateOne = vi.fn().mockResolvedValue(entryWithWarning);
    const setCached = vi.fn().mockResolvedValue(undefined);
    const deps = createMockDeps({ translateOne, setCached });
    const service = createTopicService(deps);

    const dataset = getDataset("food")!;
    const word = dataset.words[0];

    await service.regenerateTopicWord("food", word, "en", "cs");

    const cachedContent = setCached.mock.calls[0][0].content as LanguageTranslationEntry;
    expect(cachedContent.connotationWarning).toBe("vzrušit — sexual connotation in some contexts");
  });
});

// ─────────────────────────────────────────────
// generateCustomTopic — connotationWarning
// ─────────────────────────────────────────────

describe("generateCustomTopic with connotationWarning", () => {
  it("preserves connotationWarning in custom topic words", async () => {
    const generateWords = vi.fn().mockResolvedValue({
      name: "Emotions",
      emoji: "💡",
      words: ["excite", "arouse"],
    });

    const translateBatch = vi
      .fn()
      .mockResolvedValue([
        makeTranslateOutputWithWarning("excite", ["cs"]),
        makeTranslateOutputWithWarning("arouse", ["cs"]),
      ]);

    const deps = createMockDeps({ generateWords, translateBatch });
    const service = createTopicService(deps);

    const topic = await service.generateCustomTopic("emotions", "en", ["cs"]);

    expect(topic.words[0].translations.cs.connotationWarning).toBeDefined();
    expect(topic.words[1].translations.cs.connotationWarning).toBeDefined();
  });
});
