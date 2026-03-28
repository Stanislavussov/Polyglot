/**
 * Tests for translation integration in the topics layer.
 *
 * After Task 15 (context-enrichment layer), dictionary context lookup
 * is no longer in the topics service. The injected translateBatch / translateOne
 * functions are expected to handle context enrichment themselves.
 *
 * These tests verify:
 * - translateBatch is called with the simplified signature (no dictionaryContexts map)
 * - translateOne is called with the simplified signature (no dictionaryContext)
 * - Cached words skip translation entirely
 * - DictionaryContext type shape is unchanged
 */
import { describe, expect, it, vi } from "vitest";
import { MINIMAL_OUTPUT } from "../../translation/translation-output.presets.js";
import type { DictionaryContext, TranslateOutput } from "../../translation/types.js";
import { createTopicService, getDataset } from "../topic.service.js";
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
// getTopicWords — translation integration (post context-enrichment refactor)
// ─────────────────────────────────────────────

describe("getTopicWords — translation integration", () => {
  it("calls translateBatch with 4 args (words, sourceLang, targetLangs, outputConfig)", async () => {
    const dataset = getDataset("food")!;
    const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs"])));

    const deps = createMockDeps({ translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(translateBatch.mock.calls[0]).toHaveLength(4);
    expect(translateBatch).toHaveBeenCalledWith(dataset.words, "en", ["cs"], MINIMAL_OUTPUT);
  });

  it("skips translation for cached words", async () => {
    const _dataset = getDataset("food")!;

    // Cache all words
    const getCached = vi
      .fn()
      .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
        Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang)),
      );

    const translateBatch = vi.fn();

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // Everything cached — no translation needed
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("translates only uncached words", async () => {
    const dataset = getDataset("food")!;
    const cachedWords = new Set(dataset.words.slice(0, 5));
    const uncachedWords = dataset.words.filter((w) => !cachedWords.has(w));

    const getCached = vi
      .fn()
      .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
        cachedWords.has(original)
          ? Promise.resolve(makeCachedTranslation(topicId, original, sourceLang, targetLang))
          : Promise.resolve(null),
      );

    const translateBatch = vi.fn().mockResolvedValue(uncachedWords.map((w) => makeTranslateOutput(w, ["cs"])));

    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    expect(translateBatch).toHaveBeenCalledWith(uncachedWords, "en", ["cs"], MINIMAL_OUTPUT);
  });
});

// ─────────────────────────────────────────────
// regenerateTopicWord — simplified signature
// ─────────────────────────────────────────────

describe("regenerateTopicWord — simplified", () => {
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

  it("calls translateOne with 4 args (word, sourceLang, targetLang, outputConfig)", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0]!;

    const translateOne = vi.fn().mockResolvedValue(mockTranslationEntry);

    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "cs");

    expect(translateOne).toHaveBeenCalledTimes(1);
    expect(translateOne).toHaveBeenCalledWith(word, "en", "cs", MINIMAL_OUTPUT);
  });
});

// ─────────────────────────────────────────────
// generateCustomTopic — simplified signature
// ─────────────────────────────────────────────

describe("generateCustomTopic — simplified", () => {
  it("calls translateBatch with 4 args for generated words (incl. MINIMAL_OUTPUT)", async () => {
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

    await service.generateCustomTopic("sport words", "en", ["cs"]);

    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(translateBatch.mock.calls[0]).toHaveLength(4);
    expect(translateBatch).toHaveBeenCalledWith(["football", "basketball", "tennis"], "en", ["cs"], MINIMAL_OUTPUT);
  });
});

// ─────────────────────────────────────────────
// DictionaryContext type shape (unchanged)
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
