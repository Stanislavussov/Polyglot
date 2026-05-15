import type { TranslateOutput } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock logger (hoisted to avoid TDZ issues)
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@polyglot/core", () => ({
  logger: mockLogger,
}));

vi.mock("@polyglot/infra", () => ({
  logger: mockLogger,
}));

import { toVocabularyInput } from "./vocabulary-mapper.js";

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  nativeSynonyms: [{ text: "привет" }],
  translations: {
    cs: {
      text: "ahoj",
      transcription: "ˈahoj",
      synonyms: [{ text: "nazdar" }],
      examples: [{ context: "colloquial", target: "Ahoj!" }],
      expressionType: "literal",
      equivalentNote: "Standard greeting",
      connotationWarning: "Very informal",
    },
    de: {
      text: "hallo",
      synonyms: [],
      examples: [{ context: "neutral", target: "Hallo!" }],
    },
  },
  needsReview: true,
  dictionaryContext: {
    word: "hello",
    pos: "interjection",
    glosses: ["a greeting"],
    langCode: "en",
  },
};

const langResolver = (code: string): number | null => {
  const map: Record<string, number> = { cs: 3, de: 4, en: 1 };
  return map[code] ?? null;
};

describe("toVocabularyInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("correctly maps TranslateOutput → CreateVocabularyInput", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);

    expect(result.original).toBe("hello");
    expect(result.sourceLangId).toBe(1);
    expect(result.inputType).toBe("word");
    expect(result.emoji).toBe("👋");
    expect(result.translations).toHaveLength(2);
  });

  it("extracts emoji and register to parent level", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);
    expect(result.emoji).toBe("👋");
  });

  it("maps each translations[code] to a separate entry in translations[]", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);

    const cs = result.translations.find((t) => t.targetLangId === 3);
    const de = result.translations.find((t) => t.targetLangId === 4);

    expect(cs).toBeDefined();
    expect(cs!.text).toBe("ahoj");
    expect(cs!.transcription).toBe("ˈahoj");
    expect(cs!.expressionType).toBe("literal");
    expect(cs!.equivalentNote).toBe("Standard greeting");
    expect(cs!.connotationWarning).toBe("Very informal");

    expect(de).toBeDefined();
    expect(de!.text).toBe("hallo");
  });

  it("builds details with synonyms, examples, alternatives", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);

    const cs = result.translations.find((t) => t.targetLangId === 3)!;
    expect(cs.details.synonyms).toEqual([{ text: "nazdar" }]);
    expect(cs.details.examples).toEqual([{ context: "colloquial", target: "Ahoj!" }]);

    const de = result.translations.find((t) => t.targetLangId === 4)!;
    expect(de.details.synonyms).toEqual([]);
    expect(de.details.examples).toHaveLength(1);
    expect(de.details.alternatives).toBeUndefined();
  });

  it("skips unknown language codes and logs a warning", () => {
    const outputWithUnknown: TranslateOutput = {
      ...sampleOutput,
      translations: {
        ...sampleOutput.translations,
        xx: {
          text: "unknown",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = toVocabularyInput(outputWithUnknown, 1, "word", langResolver);

    // xx should be skipped, only cs and de remain
    expect(result.translations).toHaveLength(2);
    expect(result.translations.find((t) => t.text === "unknown")).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: "xx" }),
      expect.stringContaining("Unknown language code"),
    );
  });

  it("does not mutate the input TranslateOutput object", () => {
    const original = JSON.parse(JSON.stringify(sampleOutput));
    toVocabularyInput(sampleOutput, 1, "word", langResolver);
    expect(sampleOutput).toEqual(original);
  });

  it("strips needsReview — not present in output", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);
    expect("needsReview" in result).toBe(false);
  });

  it("strips dictionaryContext — not present in output", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);
    expect("dictionaryContext" in result).toBe(false);
  });

  it("strips sourceLang — uses sourceLangId instead", () => {
    const result = toVocabularyInput(sampleOutput, 1, "word", langResolver);
    expect("sourceLang" in result).toBe(false);
    expect(result.sourceLangId).toBe(1);
  });

  it("works when translations is empty", () => {
    const minimal: TranslateOutput = {
      original: "test",
      sourceLang: "en",
      emoji: "🔤",
      nativeSynonyms: [],
      translations: {},
    };

    const result = toVocabularyInput(minimal, 1, "word", langResolver);
    expect(result.translations).toEqual([]);
    expect(result.emoji).toBe("🔤");
  });

  it("works when all languages are unknown (returns empty translations)", () => {
    const allUnknown: TranslateOutput = {
      original: "test",
      sourceLang: "en",
      emoji: "🔤",
      nativeSynonyms: [],
      translations: {},
    };

    const result = toVocabularyInput(allUnknown, 1, "word", langResolver);
    expect(result.translations).toEqual([]);
  });

  it("passes inputType through correctly", () => {
    const result = toVocabularyInput(sampleOutput, 1, "phrase", langResolver);
    expect(result.inputType).toBe("phrase");
  });

  it("handles missing optional fields on LanguageTranslation gracefully", () => {
    const minimal: TranslateOutput = {
      original: "test",
      sourceLang: "en",
      emoji: "🔤",
      nativeSynonyms: [],
      translations: {
        cs: {
          text: "test",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = toVocabularyInput(minimal, 1, "word", langResolver);
    const cs = result.translations[0]!;
    expect(cs.transcription).toBeUndefined();
    expect(cs.expressionType).toBeUndefined();
    expect(cs.equivalentNote).toBeUndefined();
    expect(cs.connotationWarning).toBeUndefined();
    expect(cs.details.alternatives).toBeUndefined();
  });
});
