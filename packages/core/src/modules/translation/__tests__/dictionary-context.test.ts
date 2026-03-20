/**
 * Tests for Task 13: Wiktionary Dictionary Context Integration.
 *
 * Covers:
 * - DictionaryContext type in TranslateInput/TranslateOutput
 * - Prompt enrichment with dictionary context
 * - Phrase/idiom detection hints
 * - Edge cases: empty glosses, missing formTags, long gloss lists
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildTranslationPrompt,
  buildStrictPrompt,
} from "../prompt.builder.js";
import { translate, translateOne } from "../translation.service.js";
import type {
  TranslationRequest,
  TranslateInput,
  TranslationResult,
  DictionaryContext,
} from "../types.js";

// ─────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────

const sampleDictionaryContext: DictionaryContext = {
  word: "что ли",
  pos: "phrase",
  glosses: [
    "or something, perhaps, maybe, as if (or something like that - usually used in a question)",
  ],
  formTags: ["canonical"],
  langCode: "ru",
};

const idiomDictionaryContext: DictionaryContext = {
  word: "сорока на хвосте принесла",
  pos: "idiom",
  glosses: ["a little bird told me"],
  formTags: ["canonical", "romanization"],
  langCode: "ru",
};

const nounDictionaryContext: DictionaryContext = {
  word: "стол",
  pos: "noun",
  glosses: ["table", "desk", "board (food served at table)"],
  langCode: "ru",
};

function makeValidResult(
  overrides?: Partial<TranslationResult>,
): TranslationResult {
  return {
    emoji: "❓",
    register: "colloquial",
    translations: {
      en: {
        text: "or something",
        cefr: "B1",
        register: "colloquial",
        synonyms: [{ text: "perhaps", register: "neutral" }],
        examples: [
          {
            context: "formal",
            target: "Is this or something you wanted?",
            native: "Это что ли то, что ты хотел?",
          },
          {
            context: "colloquial",
            target: "Are you tired or something?",
            native: "Ты устал что ли?",
          },
          {
            context: "professional",
            target: "Should we proceed or something else?",
            native: "Нам продолжить что ли?",
          },
        ],
      },
    },
    ...overrides,
  };
}

const baseRequest: TranslationRequest = {
  text: "что ли",
  sourceLang: "ru",
  targetLangs: ["en"],
};

const defaultInput: TranslateInput = {
  word: "что ли",
  sourceLang: "ru",
  targetLangs: ["en"],
  model: "openai/gpt-4o",
};

// ─────────────────────────────────────────────
// buildTranslationPrompt — dictionary context
// ─────────────────────────────────────────────

describe("buildTranslationPrompt — dictionary context", () => {
  it("includes dictionary context section when provided", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain("Authoritative Dictionary Context (Wiktionary):");
  });

  it("includes the word and language code", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain('"что ли"');
    expect(prompt).toContain("(ru)");
  });

  it("includes part of speech", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain("part of speech: phrase");
  });

  it("includes glosses/definitions as verified meaning", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain("The verified meaning of this word is:");
    expect(prompt).toContain("or something, perhaps, maybe");
  });

  it("includes form tags with human-readable explanations", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain("Word form: this is the base/dictionary form of the word");
  });

  it("includes MUST-use instruction when glosses are present", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain(
      "You MUST use these definitions as the PRIMARY basis for your translation",
    );
  });

  it("includes instruction to reflect meanings in alternatives and synonyms", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain(
      "each alternative should capture a different sense",
    );
  });

  it("does NOT include MUST-use instruction when glosses are empty", () => {
    const prompt = buildTranslationPrompt({
      text: "test",
      sourceLang: "en",
      targetLangs: ["ru"],
      dictionaryContext: {
        word: "test",
        pos: "noun",
        glosses: [],
        langCode: "en",
      },
    });
    expect(prompt).not.toContain(
      "You MUST use these definitions",
    );
  });

  it("includes fixed expression hint for pos=phrase", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain(
      "This is a fixed expression — translate the meaning, not word-by-word.",
    );
  });

  it("includes fixed expression hint for pos=idiom", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      text: "сорока на хвосте принесла",
      dictionaryContext: idiomDictionaryContext,
    });
    expect(prompt).toContain(
      "This is a fixed expression — translate the meaning, not word-by-word.",
    );
  });

  it("does NOT include fixed expression hint for pos=noun", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      text: "стол",
      dictionaryContext: nounDictionaryContext,
    });
    expect(prompt).not.toContain(
      "This is a fixed expression — translate the meaning, not word-by-word.",
    );
  });

  it("does NOT include dictionary context section when not provided", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).not.toContain("Authoritative Dictionary Context");
    expect(prompt).not.toContain("Wiktionary");
  });

  it("omits form tags line when formTags is empty", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: {
        ...sampleDictionaryContext,
        formTags: [],
      },
    });
    expect(prompt).not.toContain("Word form:");
  });

  it("omits form tags line when formTags is undefined", () => {
    const ctx: DictionaryContext = {
      word: "что ли",
      pos: "phrase",
      glosses: ["or something"],
      langCode: "ru",
    };
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: ctx,
    });
    expect(prompt).not.toContain("Word form:");
  });

  it("limits glosses to 5 in the prompt to avoid bloat", () => {
    const manyGlosses: DictionaryContext = {
      word: "run",
      pos: "verb",
      glosses: [
        "to move swiftly",
        "to operate",
        "to manage",
        "to flow",
        "to extend",
        "to smuggle",
        "to publish",
        "to campaign",
      ],
      langCode: "en",
    };
    const prompt = buildTranslationPrompt({
      text: "run",
      sourceLang: "en",
      targetLangs: ["ru"],
      dictionaryContext: manyGlosses,
    });
    // Should include first 5 but not 6th+
    expect(prompt).toContain("to move swiftly");
    expect(prompt).toContain("to extend");
    expect(prompt).not.toContain("to smuggle");
    expect(prompt).not.toContain("to publish");
  });

  it("handles empty glosses array gracefully", () => {
    const emptyGlosses: DictionaryContext = {
      word: "test",
      pos: "noun",
      glosses: [],
      langCode: "en",
    };
    const prompt = buildTranslationPrompt({
      text: "test",
      sourceLang: "en",
      targetLangs: ["ru"],
      dictionaryContext: emptyGlosses,
    });
    expect(prompt).toContain("Authoritative Dictionary Context");
    expect(prompt).toContain("part of speech: noun");
    expect(prompt).not.toContain("verified meaning");
  });

  it("coexists with topic hint", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      topic: "medicine",
      dictionaryContext: sampleDictionaryContext,
    });
    expect(prompt).toContain("medicine");
    expect(prompt).toContain("Authoritative Dictionary Context");
    expect(prompt).toContain("part of speech: phrase");
  });

  it("places dictionary context before topic hint and JSON template", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      topic: "medicine",
      dictionaryContext: sampleDictionaryContext,
    });
    const dictIdx = prompt.indexOf("Authoritative Dictionary Context");
    const topicIdx = prompt.indexOf("medicine");
    const jsonIdx = prompt.indexOf("Return ONLY valid JSON");
    expect(dictIdx).toBeGreaterThan(-1);
    expect(dictIdx).toBeLessThan(topicIdx);
    expect(dictIdx).toBeLessThan(jsonIdx);
  });

  it("includes multiple form tags with explanations", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      dictionaryContext: idiomDictionaryContext,
    });
    expect(prompt).toContain("Word form: this is the base/dictionary form of the word; a romanized transliteration is available");
  });
});

// ─────────────────────────────────────────────
// buildStrictPrompt — dictionary context
// ─────────────────────────────────────────────

describe("buildStrictPrompt — dictionary context", () => {
  it("includes dictionary context in strict retry prompt", () => {
    const prompt = buildStrictPrompt(
      {
        ...baseRequest,
        dictionaryContext: sampleDictionaryContext,
      },
      ["some error"],
    );
    expect(prompt).toContain("Authoritative Dictionary Context (Wiktionary):");
    expect(prompt).toContain("part of speech: phrase");
    expect(prompt).toContain("or something, perhaps, maybe");
  });

  it("does not include dictionary context when not provided", () => {
    const prompt = buildStrictPrompt(baseRequest, ["some error"]);
    expect(prompt).not.toContain("Authoritative Dictionary Context");
  });
});

// ─────────────────────────────────────────────
// translate() — dictionary context passthrough
// ─────────────────────────────────────────────

describe("translate — dictionary context passthrough", () => {
  it("passes dictionary context to the prompt", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const input: TranslateInput = {
      ...defaultInput,
      dictionaryContext: sampleDictionaryContext,
    };

    await translate(input, mockGenerate);

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain("Authoritative Dictionary Context (Wiktionary):");
    expect(prompt).toContain("part of speech: phrase");
  });

  it("includes dictionaryContext in the output when provided", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const input: TranslateInput = {
      ...defaultInput,
      dictionaryContext: sampleDictionaryContext,
    };

    const result = await translate(input, mockGenerate);

    expect(result.dictionaryContext).toBeDefined();
    expect(result.dictionaryContext!.word).toBe("что ли");
    expect(result.dictionaryContext!.pos).toBe("phrase");
    expect(result.dictionaryContext!.glosses).toContain(
      "or something, perhaps, maybe, as if (or something like that - usually used in a question)",
    );
  });

  it("does NOT include dictionaryContext in output when not provided", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    const result = await translate(defaultInput, mockGenerate);

    expect(result.dictionaryContext).toBeUndefined();
  });

  it("preserves dictionaryContext through validation retries", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // First call: bad result, second: good result
    const badResult = makeValidResult({
      translations: {
        en: {
          text: "что ли", // same as original → semantic fail
          cefr: "B1",
          register: "colloquial",
          synonyms: [{ text: "perhaps", register: "neutral" }],
          examples: [
            {
              context: "formal",
              target: "что ли sentence.",
              native: "что ли предложение.",
            },
          ],
        },
      },
    });

    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce(badResult)
      .mockResolvedValueOnce(makeValidResult());

    const input: TranslateInput = {
      ...defaultInput,
      dictionaryContext: sampleDictionaryContext,
    };

    const result = await translate(input, mockGenerate);

    // Dictionary context should still be in the output
    expect(result.dictionaryContext).toBeDefined();
    expect(result.dictionaryContext!.pos).toBe("phrase");

    // Retry prompt should also include dictionary context
    const retryPrompt = mockGenerate.mock.calls[1][0] as string;
    expect(retryPrompt).toContain("Authoritative Dictionary Context");

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("preserves dictionaryContext when needsReview is true", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badResult = makeValidResult({
      translations: {
        en: {
          text: "что ли",
          cefr: "B1",
          register: "colloquial",
          synonyms: [{ text: "perhaps", register: "neutral" }],
          examples: [
            {
              context: "formal",
              target: "что ли sentence.",
              native: "что ли предложение.",
            },
          ],
        },
      },
    });

    const mockGenerate = vi.fn().mockResolvedValue(badResult);

    const input: TranslateInput = {
      ...defaultInput,
      dictionaryContext: sampleDictionaryContext,
    };

    const result = await translate(input, mockGenerate);

    expect(result.needsReview).toBe(true);
    expect(result.dictionaryContext).toBeDefined();
    expect(result.dictionaryContext!.word).toBe("что ли");

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────
// translateOne — dictionary context passthrough
// ─────────────────────────────────────────────

describe("translateOne — dictionary context passthrough", () => {
  it("passes dictionary context through to translate()", async () => {
    const mockGenerate = vi.fn().mockResolvedValue(makeValidResult());

    await translateOne(
      {
        ...defaultInput,
        targetLang: "en",
        dictionaryContext: sampleDictionaryContext,
      },
      mockGenerate,
    );

    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).toContain("Authoritative Dictionary Context (Wiktionary):");
  });
});

// ─────────────────────────────────────────────
// DictionaryContext type — shape verification
// ─────────────────────────────────────────────

describe("DictionaryContext type shape", () => {
  it("requires word, pos, glosses, langCode", () => {
    const ctx: DictionaryContext = {
      word: "test",
      pos: "noun",
      glosses: ["a test"],
      langCode: "en",
    };
    expect(ctx.word).toBe("test");
    expect(ctx.pos).toBe("noun");
    expect(ctx.glosses).toEqual(["a test"]);
    expect(ctx.langCode).toBe("en");
  });

  it("allows optional formTags", () => {
    const ctx: DictionaryContext = {
      word: "test",
      pos: "noun",
      glosses: ["a test"],
      langCode: "en",
      formTags: ["canonical"],
    };
    expect(ctx.formTags).toEqual(["canonical"]);
  });

  it("works without formTags", () => {
    const ctx: DictionaryContext = {
      word: "test",
      pos: "noun",
      glosses: [],
      langCode: "en",
    };
    expect(ctx.formTags).toBeUndefined();
  });
});
