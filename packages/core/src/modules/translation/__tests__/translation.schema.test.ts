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

  it("accepts optional usageNote in the generic stored-response schema", () => {
    const result = languageTranslationSchema.safeParse({
      ...validTranslation,
      usageNote: "Нейтральный вариант для повседневной речи.",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usageNote).toBe("Нейтральный вариант для повседневной речи.");
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
      nativeMeaning: "Приветствие.",
      nativeSynonyms: [{ text: "привет" }],
      translations: { cs: langEntry },
    });
    expect(result.success).toBe(false);
  });

  it("accepts native example translation when requested for AI output", () => {
    const schema = buildTranslationResultSchema(["cs"], undefined, true);
    const result = schema.safeParse({
      emoji: "👋",
      nativeMeaning: "Приветствие.",
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

  it("requires native examples only for targets different from the native language", () => {
    const schema = buildTranslationResultSchema(["cs", "ru"], undefined, true, false, "ru");
    const result = schema.safeParse({
      emoji: "➡️",
      nativeMeaning: "Постепенно прекратить использование.",
      nativeSynonyms: [{ text: "постепенно отказаться" }],
      translations: {
        cs: {
          ...langEntry,
          text: "postupně ukončit",
          examples: [
            {
              context: "policy",
              target: "Vláda chce postupně ukončit používání plastů.",
              native: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
        },
        ru: {
          ...langEntry,
          text: "постепенно отказаться",
          examples: [
            {
              context: "policy",
              target: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("still rejects a missing native example for a non-native target", () => {
    const schema = buildTranslationResultSchema(["cs", "ru"], undefined, true, false, "ru");
    const result = schema.safeParse({
      emoji: "➡️",
      nativeMeaning: "Постепенно прекратить использование.",
      nativeSynonyms: [{ text: "постепенно отказаться" }],
      translations: {
        cs: {
          ...langEntry,
          text: "postupně ukončit",
          examples: [{ context: "policy", target: "Vláda chce postupně ukončit používání plastů." }],
        },
        ru: {
          ...langEntry,
          text: "постепенно отказаться",
          examples: [
            {
              context: "policy",
              target: "Правительство хочет постепенно отказаться от пластика.",
            },
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires nativeMeaning when native output is requested", () => {
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
    expect(result.success).toBe(false);
  });

  it("requires sourceUsage when reverse-learning source usage is requested", () => {
    const schema = buildTranslationResultSchema(["en"], undefined, true, true);

    const result = schema.safeParse({
      emoji: "🪲",
      nativeMeaning: "Богомол; слово используют для названия насекомого.",
      nativeSynonyms: [{ text: "богомол" }],
      translations: {
        en: {
          text: "mantis",
          synonyms: [{ text: "praying mantis" }],
          examples: [{ context: "neutral", target: "I saw a mantis.", native: "Я увидел богомола." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts sourceUsage with source-language examples and native translations", () => {
    const schema = buildTranslationResultSchema(["en"], undefined, true, true);

    const result = schema.safeParse({
      emoji: "🪲",
      nativeMeaning: "Богомол; слово используют для названия насекомого.",
      sourceUsage: {
        explanation: "Так называют насекомое; слово нейтральное и уместно в бытовом или биологическом контексте.",
        synonyms: [{ text: "nábožná kudlanka" }],
        examples: [{ context: "nature", target: "Na zahradě seděla kudlanka.", native: "В саду сидел богомол." }],
      },
      nativeSynonyms: [{ text: "богомол" }],
      translations: {
        en: {
          text: "mantis",
          synonyms: [{ text: "praying mantis" }],
          examples: [{ context: "neutral", target: "I saw a mantis.", native: "Я увидел богомола." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("builds the native target block as minimal when source is a learning language", () => {
    const schema = buildTranslationResultSchema(["ru", "en"], undefined, true, true, "ru", false, "cs");

    const result = schema.safeParse({
      emoji: "🫐",
      nativeMeaning: "Лесная ягода.",
      sourceUsage: {
        explanation: "Так называют лесную ягоду.",
        synonyms: [{ text: "černice" }],
        examples: [
          { context: "nature", target: "V lese jsme nasbírali borůvky.", native: "В лесу мы набрали черники." },
        ],
      },
      nativeSynonyms: [{ text: "черника" }],
      translations: {
        ru: { text: "черника", synonyms: [{ text: "черничка" }] },
        en: {
          text: "blueberries",
          synonyms: [{ text: "bilberries" }],
          examples: [{ context: "neutral", target: "I like blueberries.", native: "Я люблю чернику." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects extra fields on the minimal native target block when source is a learning language", () => {
    const schema = buildTranslationResultSchema(["ru", "en"], undefined, true, true, "ru", false, "cs");

    const result = schema.safeParse({
      emoji: "🫐",
      nativeMeaning: "Лесная ягода.",
      sourceUsage: {
        explanation: "Так называют лесную ягоду.",
        synonyms: [],
        examples: [],
      },
      nativeSynonyms: [],
      translations: {
        ru: {
          text: "черника",
          synonyms: [],
          examples: [{ context: "neutral", target: "Я люблю чернику." }],
        },
        en: {
          text: "blueberries",
          synonyms: [],
          examples: [{ context: "neutral", target: "I like blueberries.", native: "Я люблю чернику." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("does NOT build a minimal native target when source equals native language", () => {
    const schema = buildTranslationResultSchema(["cs", "en"], undefined, true, false, "ru", false, "ru");

    const result = schema.safeParse({
      emoji: "🫐",
      nativeMeaning: "Лесная ягода.",
      nativeSynonyms: [{ text: "черника" }],
      translations: {
        cs: {
          text: "borůvky",
          synonyms: [],
          examples: [{ context: "neutral", target: "Mám rád borůvky.", native: "Я люблю чернику." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
        en: {
          text: "blueberries",
          synonyms: [],
          examples: [{ context: "neutral", target: "I like blueberries.", native: "Я люблю чернику." }],
          expressionType: null,
          equivalentNote: null,
          alternatives: null,
          connotationWarning: null,
        },
      },
    });

    expect(result.success).toBe(true);
  });
});
