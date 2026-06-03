import { describe, expect, it } from "vitest";
import {
  buildTranslationResultSchema,
  exampleSchema,
  languageTranslationSchema,
  synonymSchema,
  translationRequestSchema,
  translationResultSchema,
} from "../schemas/translation.schema.js";

describe("translationRequestSchema", () => {
  it("validates a correct request with one target language", () => {
    const result = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: ["cs"],
    });
    expect(result.success).toBe(true);
  });

  it("validates a correct request with multiple target languages", () => {
    const result = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: ["cs", "de", "fr"],
      topic: "greetings",
    });
    expect(result.success).toBe(true);
  });

  it("allows up to 4 target languages", () => {
    const result = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: ["cs", "de", "fr", "es"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 4 target languages", () => {
    const result = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: ["cs", "de", "fr", "es", "it"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty targetLangs array", () => {
    const result = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty text", () => {
    const result = translationRequestSchema.safeParse({
      text: "",
      sourceLang: "en",
      targetLangs: ["cs"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing sourceLang", () => {
    const result = translationRequestSchema.safeParse({
      text: "hello",
      targetLangs: ["cs"],
    });
    expect(result.success).toBe(false);
  });

  it("topic is optional", () => {
    const withTopic = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: ["cs"],
      topic: "travel",
    });
    const withoutTopic = translationRequestSchema.safeParse({
      text: "hello",
      sourceLang: "en",
      targetLangs: ["cs"],
    });
    expect(withTopic.success).toBe(true);
    expect(withoutTopic.success).toBe(true);
  });
});

describe("synonymSchema", () => {
  it("validates a correct synonym", () => {
    const result = synonymSchema.safeParse({
      text: "greeting",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    const result = synonymSchema.safeParse({
      text: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("exampleSchema", () => {
  it("validates a correct example", () => {
    const result = exampleSchema.safeParse({
      context: "neutral",
      target: "This is a neutral sentence.",
    });
    expect(result.success).toBe(true);
  });

  it("validates an example with native translation", () => {
    const result = exampleSchema.safeParse({
      context: "neutral",
      target: "Ahoj, jak se máš?",
      native: "Привет, как дела?",
    });
    expect(result.success).toBe(true);
  });

  it("allows native translation to be omitted for old saved examples", () => {
    const result = exampleSchema.safeParse({
      context: "neutral",
      target: "Ahoj, jak se máš?",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty target", () => {
    const result = exampleSchema.safeParse({
      context: "neutral",
      target: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty context", () => {
    const result = exampleSchema.safeParse({
      context: "",
      target: "text",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid context values", () => {
    for (const context of ["neutral", "colloquial", "professional"]) {
      const result = exampleSchema.safeParse({
        context,
        target: "text",
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("languageTranslationSchema", () => {
  const validTranslation = {
    text: "ahoj",
    synonyms: [{ text: "čau" }],
    examples: [
      {
        context: "neutral",
        target: "Ahoj, jak se máš?",
      },
    ],
  };

  it("validates a correct language translation", () => {
    const result = languageTranslationSchema.safeParse(validTranslation);
    expect(result.success).toBe(true);
  });

  it("allows optional transcription", () => {
    const result = languageTranslationSchema.safeParse({
      ...validTranslation,
      transcription: "[ˈahoj]",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing examples", () => {
    const result = languageTranslationSchema.safeParse({
      ...validTranslation,
      examples: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional connotationWarning field", () => {
    const result = languageTranslationSchema.safeParse({
      ...validTranslation,
      connotationWarning: "to arouse — sexual connotation",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.connotationWarning).toBe("to arouse — sexual connotation");
    }
  });

  it("allows connotationWarning to be omitted", () => {
    const result = languageTranslationSchema.safeParse(validTranslation);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.connotationWarning).toBeUndefined();
    }
  });
});

describe("translationResultSchema", () => {
  const validResult = {
    emoji: "👋",
    nativeSynonyms: [{ text: "привет" }],
    translations: {
      cs: {
        text: "ahoj",
        synonyms: [{ text: "čau" }],
        examples: [
          {
            context: "neutral",
            target: "Ahoj, jak se máš?",
          },
        ],
      },
      de: {
        text: "hallo",
        synonyms: [{ text: "hi" }],
        examples: [
          {
            context: "neutral",
            target: "Hallo, wie geht es Ihnen?",
          },
        ],
      },
    },
  };

  it("validates a correct multi-language result", () => {
    const result = translationResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it("rejects missing emoji", () => {
    const { emoji, ...rest } = validResult;
    const result = translationResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing nativeSynonyms", () => {
    const { nativeSynonyms, ...rest } = validResult;
    const result = translationResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing translations", () => {
    const { translations, ...rest } = validResult;
    const result = translationResultSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("validates a single-language result", () => {
    const result = translationResultSchema.safeParse({
      emoji: "👋",
      nativeSynonyms: [{ text: "привет" }],
      translations: {
        cs: validResult.translations.cs,
      },
    });
    expect(result.success).toBe(true);
  });

  it("preserves all fields after parsing", () => {
    const result = translationResultSchema.parse(validResult);
    expect(result.emoji).toBe("👋");
    expect(result.translations.cs.text).toBe("ahoj");
    expect(result.translations.cs.synonyms).toHaveLength(1);
    expect(result.translations.cs.examples).toHaveLength(1);
    expect(result.translations.de.text).toBe("hallo");
  });
});

describe("buildTranslationResultSchema", () => {
  const langEntry = {
    text: "ahoj",
    synonyms: [{ text: "čau" }],
    examples: [{ context: "neutral", target: "Ahoj, jak se máš?" }],
    transcription: null,
    expressionType: null,
    equivalentNote: null,
    alternatives: null,
    connotationWarning: null,
  };

  it("requires specified language keys", () => {
    const schema = buildTranslationResultSchema(["cs", "en"]);
    const result = schema.safeParse({
      emoji: "👋",
      translations: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when some required languages are missing", () => {
    const schema = buildTranslationResultSchema(["cs", "en"]);
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [{ text: "привет" }],
      translations: { cs: langEntry },
    });
    expect(result.success).toBe(false);
  });

  it("accepts when all required languages are present", () => {
    const schema = buildTranslationResultSchema(["cs", "en"]);
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [{ text: "привет" }],
      translations: { cs: langEntry, en: { ...langEntry, text: "hello" } },
    });
    expect(result.success).toBe(true);
  });

  it("validates language entry structure", () => {
    const schema = buildTranslationResultSchema(["cs"]);
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [{ text: "привет" }],
      translations: { cs: { text: "ahoj" } },
    });
    expect(result.success).toBe(false);
  });

  it("requires native example translation when requested for AI output", () => {
    const schema = buildTranslationResultSchema(["cs"], undefined, true);
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [{ text: "привет" }],
      translations: { cs: langEntry },
    });
    expect(result.success).toBe(false);
  });

  it("accepts native example translation when requested for AI output", () => {
    const schema = buildTranslationResultSchema(["cs"], undefined, true);
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [{ text: "привет" }],
      translations: {
        cs: {
          ...langEntry,
          examples: [{ context: "neutral", target: "Ahoj, jak se máš?", native: "Привет, как дела?" }],
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
