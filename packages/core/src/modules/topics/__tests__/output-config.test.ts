/**
 * Tests for TranslationOutputConfig passthrough in the topics layer.
 *
 * Verifies that the topic service always passes MINIMAL_OUTPUT preset
 * to injected translateBatch and translateOne functions. Topics only
 * need core fields + transcription — no examples, synonyms, alternatives,
 * or equivalent notes — to save tokens during bulk translation.
 */
import { describe, expect, it, vi } from "vitest";
import { MINIMAL_OUTPUT } from "../../translation/translation-output.presets.js";
import type { TranslateOutput } from "../../translation/types.js";
import { createTopicService, getDataset } from "../topic.service.js";
import type { LanguageTranslationEntry, TopicDeps } from "../types.js";

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
      synonyms: [],
      examples: [],
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

function createMockDeps(overrides?: Partial<TopicDeps>): TopicDeps {
  return {
    translateBatch: vi.fn().mockResolvedValue([]),
    getCached: vi.fn().mockResolvedValue(null),
    setCached: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// MINIMAL_OUTPUT preset verification
// ─────────────────────────────────────────────

describe("MINIMAL_OUTPUT preset used by topics", () => {
  it("MINIMAL_OUTPUT has includeTranscription: true, all others false", () => {
    expect(MINIMAL_OUTPUT).toEqual({
      includeExamples: false,
      includeTranscription: true,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeCefr: false,
      includeRegister: false,
    });
  });
});

// ─────────────────────────────────────────────
// getTopicWords — passes MINIMAL_OUTPUT
// ─────────────────────────────────────────────

describe("getTopicWords passes MINIMAL_OUTPUT to translateBatch", () => {
  it("passes MINIMAL_OUTPUT as 4th argument to translateBatch", async () => {
    const dataset = getDataset("food")!;
    const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs"])));

    const deps = createMockDeps({ translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    expect(translateBatch).toHaveBeenCalledTimes(1);
    const callArgs = translateBatch.mock.calls[0];
    expect(callArgs[3]).toEqual(MINIMAL_OUTPUT);
  });

  it("passes MINIMAL_OUTPUT with multiple target languages", async () => {
    const dataset = getDataset("food")!;
    const translateBatch = vi
      .fn()
      .mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs", "de", "es"])));

    const deps = createMockDeps({ translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs", "de", "es"]);

    expect(translateBatch).toHaveBeenCalledWith(dataset.words, "en", ["cs", "de", "es"], MINIMAL_OUTPUT);
  });

  it("does not pass outputConfig when all words are cached (no translateBatch call)", async () => {
    const _dataset = getDataset("food")!;
    const getCached = vi
      .fn()
      .mockImplementation((topicId: string, original: string, sourceLang: string, targetLang: string) =>
        Promise.resolve({
          id: 1,
          topicId,
          original,
          sourceLang,
          targetLang,
          content: {
            text: `${original}_${targetLang}_cached`,
            cefr: "A1",
            register: "neutral",
            synonyms: [],
            examples: [],
          },
          isValid: true,
          invalidReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

    const translateBatch = vi.fn();
    const deps = createMockDeps({ getCached, translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("food", "en", ["cs"]);

    // All cached — translateBatch should not be called at all
    expect(translateBatch).not.toHaveBeenCalled();
  });

  it("passes MINIMAL_OUTPUT for different topic IDs", async () => {
    const dataset = getDataset("travel")!;
    const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["de"])));

    const deps = createMockDeps({ translateBatch });
    const service = createTopicService(deps);

    await service.getTopicWords("travel", "en", ["de"]);

    const callArgs = translateBatch.mock.calls[0];
    expect(callArgs[3]).toBe(MINIMAL_OUTPUT);
  });
});

// ─────────────────────────────────────────────
// generateCustomTopic — passes MINIMAL_OUTPUT
// ─────────────────────────────────────────────

describe("generateCustomTopic passes MINIMAL_OUTPUT to translateBatch", () => {
  it("passes MINIMAL_OUTPUT as 4th argument for custom topic translation", async () => {
    const generateWords = vi.fn().mockResolvedValue({
      name: "Colors",
      emoji: "🎨",
      words: ["red", "blue", "green"],
    });

    const translateBatch = vi
      .fn()
      .mockResolvedValue([
        makeTranslateOutput("red", ["cs"]),
        makeTranslateOutput("blue", ["cs"]),
        makeTranslateOutput("green", ["cs"]),
      ]);

    const deps = createMockDeps({ generateWords, translateBatch });
    const service = createTopicService(deps);

    await service.generateCustomTopic("colors", "en", ["cs"]);

    expect(translateBatch).toHaveBeenCalledWith(["red", "blue", "green"], "en", ["cs"], MINIMAL_OUTPUT);
  });
});

// ─────────────────────────────────────────────
// regenerateTopicWord — passes MINIMAL_OUTPUT
// ─────────────────────────────────────────────

describe("regenerateTopicWord passes MINIMAL_OUTPUT to translateOne", () => {
  const mockEntry: LanguageTranslationEntry = {
    text: "jablko",
    cefr: "A1",
    register: "neutral",
    synonyms: [],
    examples: [],
  };

  it("passes MINIMAL_OUTPUT as 4th argument to translateOne", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0]!;

    const translateOne = vi.fn().mockResolvedValue(mockEntry);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "cs");

    expect(translateOne).toHaveBeenCalledTimes(1);
    expect(translateOne).toHaveBeenCalledWith(word, "en", "cs", MINIMAL_OUTPUT);
  });

  it("passes MINIMAL_OUTPUT for different target languages", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0]!;

    const translateOne = vi.fn().mockResolvedValue(mockEntry);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("food", word, "en", "de");

    expect(translateOne).toHaveBeenCalledWith(word, "en", "de", MINIMAL_OUTPUT);
  });

  it("passes MINIMAL_OUTPUT for it-terms topic", async () => {
    const dataset = getDataset("it-terms")!;
    const word = dataset.words[0]!;

    const translateOne = vi.fn().mockResolvedValue(mockEntry);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    await service.regenerateTopicWord("it-terms", word, "en", "cs");

    const callArgs = translateOne.mock.calls[0];
    expect(callArgs[3]).toBe(MINIMAL_OUTPUT);
  });
});

// ─────────────────────────────────────────────
// TopicDeps interface — outputConfig param type
// ─────────────────────────────────────────────

describe("TopicDeps accepts outputConfig parameter", () => {
  it("translateBatch accepts optional 4th outputConfig argument", async () => {
    const dataset = getDataset("food")!;
    const translateBatch = vi.fn().mockResolvedValue(dataset.words.map((w) => makeTranslateOutput(w, ["cs"])));

    const deps = createMockDeps({ translateBatch });
    const service = createTopicService(deps);

    // Should not throw — the 4th argument is valid
    await expect(service.getTopicWords("food", "en", ["cs"])).resolves.toBeDefined();

    // Verify the mock received 4 arguments
    expect(translateBatch.mock.calls[0]).toHaveLength(4);
  });

  it("translateOne accepts optional 4th outputConfig argument", async () => {
    const dataset = getDataset("food")!;
    const word = dataset.words[0]!;
    const mockEntry: LanguageTranslationEntry = {
      text: "jablko",
      cefr: "A1",
      register: "neutral",
      synonyms: [],
      examples: [],
    };

    const translateOne = vi.fn().mockResolvedValue(mockEntry);
    const deps = createMockDeps({ translateOne });
    const service = createTopicService(deps);

    // Should not throw — the 4th argument is valid
    await expect(service.regenerateTopicWord("food", word, "en", "cs")).resolves.toBeDefined();

    // Verify the mock received 4 arguments
    expect(translateOne.mock.calls[0]).toHaveLength(4);
  });
});
