import { describe, it, expect } from "vitest";
import {
  translationRequestSchema,
  translationResultSchema,
  languageTranslationSchema,
  synonymSchema,
  exampleSchema,
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
      register: "neutral",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty text", () => {
    const result = synonymSchema.safeParse({
      text: "",
      register: "neutral",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid register", () => {
    const result = synonymSchema.safeParse({
      text: "greeting",
      register: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid register values", () => {
    for (const register of [
      "slang",
      "colloquial",
      "neutral",
      "literary",
      "professional",
    ]) {
      const result = synonymSchema.safeParse({ text: "word", register });
      expect(result.success).toBe(true);
    }
  });
});

describe("exampleSchema", () => {
  it("validates a correct example", () => {
    const result = exampleSchema.safeParse({
      context: "formal",
      target: "This is a formal sentence.",
      native: "Toto je formální věta.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty target", () => {
    const result = exampleSchema.safeParse({
      context: "formal",
      target: "",
      native: "Some native text.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty native", () => {
    const result = exampleSchema.safeParse({
      context: "formal",
      target: "Some target text.",
      native: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid context", () => {
    const result = exampleSchema.safeParse({
      context: "casual",
      target: "text",
      native: "text",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid context values", () => {
    for (const context of ["formal", "colloquial", "professional"]) {
      const result = exampleSchema.safeParse({
        context,
        target: "text",
        native: "text",
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("languageTranslationSchema", () => {
  const validTranslation = {
    text: "ahoj",
    cefr: "A1",
    register: "colloquial",
    synonyms: [{ text: "čau", register: "slang" }],
    examples: [
      {
        context: "formal",
        target: "Ahoj, jak se máš?",
        native: "Hello, how are you?",
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

  it("rejects invalid CEFR level", () => {
    const result = languageTranslationSchema.safeParse({
      ...validTranslation,
      cefr: "D1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid CEFR levels", () => {
    for (const cefr of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      const result = languageTranslationSchema.safeParse({
        ...validTranslation,
        cefr,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("translationResultSchema", () => {
  const validResult = {
    emoji: "👋",
    register: "neutral",
    translations: {
      cs: {
        text: "ahoj",
        cefr: "A1",
        register: "colloquial",
        synonyms: [{ text: "čau", register: "slang" }],
        examples: [
          {
            context: "formal",
            target: "Ahoj, jak se máš?",
            native: "Hello, how are you?",
          },
        ],
      },
      de: {
        text: "hallo",
        cefr: "A1",
        register: "neutral",
        synonyms: [{ text: "hi", register: "colloquial" }],
        examples: [
          {
            context: "formal",
            target: "Hallo, wie geht es Ihnen?",
            native: "Hello, how are you?",
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

  it("rejects missing register", () => {
    const { register, ...rest } = validResult;
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
      register: "neutral",
      translations: {
        cs: validResult.translations.cs,
      },
    });
    expect(result.success).toBe(true);
  });

  it("preserves all fields after parsing", () => {
    const result = translationResultSchema.parse(validResult);
    expect(result.emoji).toBe("👋");
    expect(result.register).toBe("neutral");
    expect(result.translations.cs.text).toBe("ahoj");
    expect(result.translations.cs.cefr).toBe("A1");
    expect(result.translations.cs.synonyms).toHaveLength(1);
    expect(result.translations.cs.examples).toHaveLength(1);
    expect(result.translations.de.text).toBe("hallo");
  });
});
