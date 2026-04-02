import { describe, expect, it } from "vitest";
import type { LanguageTranslation } from "../../../translation/types.js";
import { buildLiteValidationPrompt } from "../prompt.builder.js";
import type { LiteValidationInput } from "../types.js";

/** Minimal valid language translation for testing */
function makeTranslation(overrides?: Partial<LanguageTranslation>): LanguageTranslation {
  return {
    text: "ahoj",
    cefr: "A1",
    register: "colloquial",
    synonyms: [],
    examples: [],
    ...overrides,
  };
}

describe("buildLiteValidationPrompt", () => {
  const singleLangInput: LiteValidationInput = {
    original: "hello",
    sourceLang: "en",
    translations: {
      cs: makeTranslation({ text: "ahoj" }),
    },
  };

  const multiLangInput: LiteValidationInput = {
    original: "hello",
    sourceLang: "en",
    translations: {
      cs: makeTranslation({ text: "ahoj" }),
      de: makeTranslation({ text: "hallo", register: "neutral", cefr: "A1" }),
    },
  };

  describe("required sections", () => {
    it("contains the original word", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain('"hello"');
    });

    it("contains the source language", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("en");
    });

    it("contains the scoring rubric", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("meaningPreserved");
      expect(prompt).toContain("naturalness");
      expect(prompt).toContain("registerAccuracy");
      expect(prompt).toContain("cefrAccuracy");
      expect(prompt).toContain("overallScore");
      expect(prompt).toContain("reasoning");
    });

    it("contains instruction to score, not rewrite", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("NOT rewrite");
      expect(prompt).toContain("only score");
    });

    it("contains the translation text", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("ahoj");
    });

    it("requests JSON output", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("valid JSON");
    });

    it("includes scoring scale 0–5", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("0–5");
    });
  });

  describe("single-language input", () => {
    it("includes only one language in JSON template", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain('"cs"');
      expect(prompt).not.toContain('"de"');
    });

    it("includes translation metadata", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).toContain("colloquial");
      expect(prompt).toContain("A1");
    });
  });

  describe("multi-language input", () => {
    it("includes all target languages in JSON template", () => {
      const prompt = buildLiteValidationPrompt(multiLangInput);
      expect(prompt).toContain('"cs"');
      expect(prompt).toContain('"de"');
    });

    it("includes both translations", () => {
      const prompt = buildLiteValidationPrompt(multiLangInput);
      expect(prompt).toContain("ahoj");
      expect(prompt).toContain("hallo");
    });
  });

  describe("dictionary context", () => {
    it("includes dictionary reference when provided", () => {
      const input: LiteValidationInput = {
        ...singleLangInput,
        dictionaryContext: {
          word: "hello",
          pos: "noun",
          glosses: ["a greeting", "an exclamation"],
          langCode: "en",
        },
      };
      const prompt = buildLiteValidationPrompt(input);
      expect(prompt).toContain("DICTIONARY REFERENCE");
      expect(prompt).toContain("a greeting");
      expect(prompt).toContain("an exclamation");
      expect(prompt).toContain("noun");
    });

    it("omits dictionary section when not provided", () => {
      const prompt = buildLiteValidationPrompt(singleLangInput);
      expect(prompt).not.toContain("DICTIONARY REFERENCE");
    });
  });

  describe("expression type", () => {
    it("includes expressionType when present", () => {
      const input: LiteValidationInput = {
        ...singleLangInput,
        translations: {
          cs: makeTranslation({
            text: "nazdárek",
            expressionType: "idiomatic_equivalent",
            equivalentNote: "Casual Czech greeting",
          }),
        },
      };
      const prompt = buildLiteValidationPrompt(input);
      expect(prompt).toContain("idiomatic_equivalent");
      expect(prompt).toContain("Casual Czech greeting");
    });
  });
});
