import { describe, expect, it } from "vitest";
import { buildStrictPrompt, buildTranslationPrompt } from "../prompt.builder.js";
import {
  buildTranslationResultSchema,
  languageTranslationSchema,
  translationResultSchema,
} from "../schemas/translation.schema.js";
import type { TranslationRequest } from "../types.js";

/**
 * Tests for Task 10: Idiomatic & Proverb Equivalent Matching.
 *
 * Covers:
 * - Schema: expressionType and equivalentNote fields
 * - Prompt: idiomatic rule text in prompt output
 */

describe("Schema — expressionType and equivalentNote", () => {
  const baseTranslation = {
    text: "Having your cake and eating it too",
    register: "colloquial" as const,
    synonyms: [{ text: "best of both worlds", register: "neutral" as const }],
    examples: [
      {
        context: "neutral" as const,
        target: "You can't have your cake and eat it too.",
        register: "neutral",
      },
    ],
  };

  it("accepts expressionType as 'literal'", () => {
    const result = languageTranslationSchema.safeParse({
      ...baseTranslation,
      expressionType: "literal",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expressionType).toBe("literal");
    }
  });

  it("accepts expressionType as 'idiomatic_equivalent'", () => {
    const result = languageTranslationSchema.safeParse({
      ...baseTranslation,
      expressionType: "idiomatic_equivalent",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expressionType).toBe("idiomatic_equivalent");
    }
  });

  it("defaults expressionType to 'literal' when omitted", () => {
    const result = languageTranslationSchema.safeParse(baseTranslation);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expressionType).toBe("literal");
    }
  });

  it("rejects invalid expressionType values", () => {
    const result = languageTranslationSchema.safeParse({
      ...baseTranslation,
      expressionType: "metaphorical",
    });
    expect(result.success).toBe(false);
  });

  it("accepts equivalentNote as a string", () => {
    const result = languageTranslationSchema.safeParse({
      ...baseTranslation,
      expressionType: "idiomatic_equivalent",
      equivalentNote: "No direct equivalent; closest English idiom used",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.equivalentNote).toBe("No direct equivalent; closest English idiom used");
    }
  });

  it("allows equivalentNote to be omitted", () => {
    const result = languageTranslationSchema.safeParse(baseTranslation);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.equivalentNote).toBeUndefined();
    }
  });

  it("works in a full translationResultSchema with idiomatic fields", () => {
    const result = translationResultSchema.safeParse({
      emoji: "🐺",
      register: "colloquial",
      nativeSynonyms: [],
      translations: {
        en: {
          ...baseTranslation,
          expressionType: "idiomatic_equivalent",
          equivalentNote: "Closest English idiom for the Czech proverb",
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.translations.en.expressionType).toBe("idiomatic_equivalent");
      expect(result.data.translations.en.equivalentNote).toBe("Closest English idiom for the Czech proverb");
    }
  });

  it("works in buildTranslationResultSchema with idiomatic fields", () => {
    const schema = buildTranslationResultSchema(["en"]);
    const result = schema.safeParse({
      emoji: "🐺",
      register: "colloquial",
      nativeSynonyms: [],
      translations: {
        en: {
          ...baseTranslation,
          transcription: null,
          expressionType: "idiomatic_equivalent",
          equivalentNote: "Closest English idiom",
          alternatives: null,
          connotationWarning: null,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("allows per-language expressionType — one literal, one idiomatic", () => {
    const result = translationResultSchema.safeParse({
      emoji: "🐺",
      register: "colloquial",
      nativeSynonyms: [],
      translations: {
        en: {
          ...baseTranslation,
          expressionType: "idiomatic_equivalent",
          equivalentNote: "English idiom used",
        },
        de: {
          ...baseTranslation,
          text: "Den Kuchen haben und ihn auch essen",
          expressionType: "literal",
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.translations.en.expressionType).toBe("idiomatic_equivalent");
      expect(result.data.translations.de.expressionType).toBe("literal");
    }
  });

  it("preserves backward compatibility — data without idiomatic fields parses fine", () => {
    const data = {
      text: "ahoj",
      register: "colloquial",
      synonyms: [{ text: "čau", register: "slang" }],
      examples: [
        {
          context: "neutral",
          target: "Ahoj, jak se máš?",
          register: "нейтральный",
        },
      ],
    };
    const result = languageTranslationSchema.safeParse(data);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expressionType).toBe("literal");
      expect(result.data.equivalentNote).toBeUndefined();
    }
  });
});

describe("Prompt — idiomatic rule", () => {
  const baseRequest: TranslationRequest = {
    text: "Vlk se nažral a koza zůstala celá",
    sourceLang: "cs",
    targetLangs: ["en", "de"],
  };

  it("includes the Idiomatic & Proverb Rule section", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("Idiomatic & Proverb Rule:");
  });

  it("mentions idiomatic_equivalent in the prompt", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("idiomatic_equivalent");
  });

  it("mentions equivalentNote in the prompt", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("equivalentNote");
  });

  it("mentions expressionType in the JSON template", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"expressionType"');
  });

  it("instructs to NEVER return meaningless word-for-word rendering", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("NEVER return a meaningless word-for-word");
  });

  it("mentions CLOSEST FUNCTIONAL EQUIVALENT", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("CLOSEST");
    expect(prompt).toContain("FUNCTIONAL EQUIVALENT");
  });

  it("strict prompt also includes the idiomatic rule", () => {
    const prompt = buildStrictPrompt(baseRequest, ["some error"]);
    expect(prompt).toContain("Idiomatic & Proverb Rule:");
    expect(prompt).toContain("idiomatic_equivalent");
  });

  it("strict prompt mentions expressionType in correction guidance", () => {
    const prompt = buildStrictPrompt(baseRequest, ["some error"]);
    expect(prompt).toContain('set expressionType to "idiomatic_equivalent" with an equivalentNote');
  });
});
