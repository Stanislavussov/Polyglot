import { describe, it, expect } from "vitest";
import {
  renderTranslation,
  renderTopicWord,
  buildTranslationKeyboard,
} from "../renderers/translation.renderer.js";
import type { TranslateOutput, TopicWord } from "@polyglot/core";

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  register: "neutral",
  translations: {
    cs: {
      text: "ahoj",
      cefr: "A1",
      transcription: "ˈahoj",
      register: "colloquial",
      synonyms: [
        { text: "dobrý den", register: "neutral" },
        { text: "nazdar", register: "colloquial" },
      ],
      examples: [
        { context: "formal", target: "Dobrý den, pane!", native: "Hello, sir!" },
        { context: "colloquial", target: "Ahoj, jak se máš?", native: "Hello, how are you?" },
        { context: "professional", target: "Dobrý den, kolegové.", native: "Hello, colleagues." },
      ],
    },
  },
};

describe("renderTranslation", () => {
  it("renders header with emoji and original word", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("👋 <b>hello</b>");
  });

  it("renders register label", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("Register: neutral");
  });

  it("renders language code in uppercase", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("🔤 CS:");
  });

  it("renders translation text as bold", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("<b>ahoj</b>");
  });

  it("renders transcription in brackets", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("[ˈahoj]");
  });

  it("renders CEFR level", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("CEFR: A1");
  });

  it("renders synonyms", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("Synonyms:");
    expect(result).toContain("dobrý den (neutral)");
    expect(result).toContain("nazdar (colloquial)");
  });

  it("renders examples with context icons", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("📎"); // formal
    expect(result).toContain("💬"); // colloquial
    expect(result).toContain("💼"); // professional
  });

  it("renders example sentences in italic", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("<i>Dobrý den, pane!</i>");
  });

  it("renders native translation after arrow", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("→ Hello, sir!");
  });

  it("does not show needsReview when false", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).not.toContain("inaccuracies");
  });

  it("shows needsReview warning when true", () => {
    const output = { ...sampleOutput, needsReview: true };
    const result = renderTranslation(output, "en");
    expect(result).toContain("inaccuracies");
  });

  it("renders in Russian when interfaceLang is ru", () => {
    const result = renderTranslation(sampleOutput, "ru");
    expect(result).toContain("Регистр: neutral");
    expect(result).toContain("Синонимы:");
    expect(result).toContain("Примеры:");
  });

  it("falls back to en for unknown interfaceLang", () => {
    const result = renderTranslation(sampleOutput, "xx");
    expect(result).toContain("Register: neutral");
  });

  it("renders without transcription when absent", () => {
    const noTranscription: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations["cs"]!,
          transcription: undefined,
        },
      },
    };
    const result = renderTranslation(noTranscription, "en");
    expect(result).toContain("🔤 CS: <b>ahoj</b>");
    expect(result).not.toContain("[");
  });

  it("renders without synonyms when empty", () => {
    const noSynonyms: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations["cs"]!,
          synonyms: [],
        },
      },
    };
    const result = renderTranslation(noSynonyms, "en");
    expect(result).not.toContain("Synonyms:");
  });

  it("renders without examples when empty", () => {
    const noExamples: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations["cs"]!,
          examples: [],
        },
      },
    };
    const result = renderTranslation(noExamples, "en");
    expect(result).not.toContain("Examples:");
  });

  it("escapes HTML special characters", () => {
    const xssOutput: TranslateOutput = {
      ...sampleOutput,
      original: "<script>alert('xss')</script>",
    };
    const result = renderTranslation(xssOutput, "en");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("renders multiple target languages", () => {
    const multiLang: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: sampleOutput.translations["cs"]!,
        de: {
          text: "hallo",
          cefr: "A1",
          register: "neutral",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTranslation(multiLang, "en");
    expect(result).toContain("🔤 CS:");
    expect(result).toContain("🔤 DE:");
    expect(result).toContain("<b>hallo</b>");
  });
});

describe("renderTopicWord", () => {
  const sampleWord: TopicWord = {
    original: "apple",
    translations: {
      cs: {
        text: "jablko",
        cefr: "A1",
        register: "neutral",
        synonyms: [],
        examples: [],
      },
      de: {
        text: "Apfel",
        cefr: "A1",
        transcription: "ˈapfəl",
        register: "neutral",
        synonyms: [],
        examples: [],
      },
    },
  };

  it("renders original word as bold header", () => {
    const result = renderTopicWord(sampleWord);
    expect(result).toContain("<b>apple</b>");
  });

  it("renders translations with language codes", () => {
    const result = renderTopicWord(sampleWord);
    expect(result).toContain("🔤 CS: <b>jablko</b>");
    expect(result).toContain("🔤 DE:");
  });

  it("renders transcription when present", () => {
    const result = renderTopicWord(sampleWord);
    expect(result).toContain("[ˈapfəl]");
  });

  it("renders without transcription when absent", () => {
    const result = renderTopicWord(sampleWord);
    // CS entry has no transcription
    expect(result).toContain("🔤 CS: <b>jablko</b>");
    // Make sure there's no spurious bracket after jablko
    const csLine = result.split("\n").find((l) => l.includes("CS:"));
    expect(csLine).not.toContain("[");
  });

  it("escapes HTML in word text", () => {
    const xssWord: TopicWord = {
      original: "<b>bad</b>",
      translations: {
        cs: {
          text: "špatný & zlý",
          cefr: "A1",
          register: "neutral",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTopicWord(xssWord);
    expect(result).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(result).toContain("špatný &amp; zlý");
  });
});

describe("buildTranslationKeyboard", () => {
  /** Extract callback_data from an inline keyboard button (union type). */
  const cbData = (btn: unknown): string | undefined =>
    (btn as { callback_data?: string }).callback_data;

  it("creates regenerate buttons for each language code", () => {
    const kb = buildTranslationKeyboard(["cs", "de", "fr"], "en");
    const rows = kb.inline_keyboard;
    // First row: regen buttons
    expect(rows[0]).toHaveLength(3);
  });

  it("uses correct callback data format tr:regen:<code>", () => {
    const kb = buildTranslationKeyboard(["cs", "de"], "en");
    const regenRow = kb.inline_keyboard[0]!;
    expect(cbData(regenRow[0])).toBe("tr:regen:cs");
    expect(cbData(regenRow[1])).toBe("tr:regen:de");
  });

  it("includes all language codes as buttons", () => {
    const codes = ["cs", "de", "fr", "es"];
    const kb = buildTranslationKeyboard(codes, "en");
    const regenRow = kb.inline_keyboard[0]!;
    const callbackDatas = regenRow.map(cbData);
    expect(callbackDatas).toEqual(codes.map((c) => `tr:regen:${c}`));
  });

  it("has save and skip buttons in second row", () => {
    const kb = buildTranslationKeyboard(["cs"], "en");
    const saveRow = kb.inline_keyboard[1]!;
    expect(saveRow).toHaveLength(2);
    expect(cbData(saveRow[0])).toBe("tr:save");
    expect(cbData(saveRow[1])).toBe("tr:skip");
  });

  it("uses i18n regenerateLang key for button text", () => {
    const kb = buildTranslationKeyboard(["cs"], "en");
    const regenBtn = kb.inline_keyboard[0]![0]!;
    expect(regenBtn.text).toBe("🔄 CS");
  });

  it("uses i18n saveToDictionary key for save button", () => {
    const kb = buildTranslationKeyboard(["cs"], "en");
    const saveBtn = kb.inline_keyboard[1]![0]!;
    expect(saveBtn.text).toContain("Save to dictionary");
  });

  it("uses i18n no key for skip button", () => {
    const kb = buildTranslationKeyboard(["cs"], "en");
    const skipBtn = kb.inline_keyboard[1]![1]!;
    expect(skipBtn.text).toContain("No");
  });

  it("renders button text using Russian locale", () => {
    const kb = buildTranslationKeyboard(["de"], "ru");
    const regenBtn = kb.inline_keyboard[0]![0]!;
    expect(regenBtn.text).toBe("🔄 DE");
    const skipBtn = kb.inline_keyboard[1]![1]!;
    expect(skipBtn.text).toContain("Нет");
  });

  it("falls back to en for unknown interface language", () => {
    const kb = buildTranslationKeyboard(["cs"], "xx");
    const saveBtn = kb.inline_keyboard[1]![0]!;
    expect(saveBtn.text).toContain("Save to dictionary");
  });

  it("works with single language code", () => {
    const kb = buildTranslationKeyboard(["fr"], "en");
    expect(kb.inline_keyboard[0]).toHaveLength(1);
    expect(cbData(kb.inline_keyboard[0]![0])).toBe("tr:regen:fr");
  });

  it("uppercases language codes in button labels", () => {
    const kb = buildTranslationKeyboard(["cs", "de"], "en");
    const labels = kb.inline_keyboard[0]!.map((b) => b.text);
    expect(labels).toEqual(["🔄 CS", "🔄 DE"]);
  });
});

// ── Alternatives rendering tests ────────────────────────────────────

describe("renderTranslation — alternatives", () => {
  const outputWithAlternatives: TranslateOutput = {
    original: "house",
    sourceLang: "en",
    emoji: "🏠",
    register: "neutral",
    translations: {
      cs: {
        text: "dům",
        cefr: "A1",
        register: "neutral",
        synonyms: [],
        examples: [
          { context: "formal", target: "Dům je velký.", native: "The house is big." },
        ],
        alternatives: [
          {
            text: "domov",
            register: "neutral",
            synonyms: [{ text: "bydliště", register: "neutral" }],
          },
          {
            text: "stavení",
            register: "literary",
            synonyms: [],
          },
        ],
      },
    },
  };

  it("renders alternatives after main translation", () => {
    const result = renderTranslation(outputWithAlternatives, "en");
    expect(result).toContain("∙ domov (neutral)");
    expect(result).toContain("∙ stavení (literary)");
  });

  it("renders alternative synonyms inline", () => {
    const result = renderTranslation(outputWithAlternatives, "en");
    expect(result).toContain("domov (neutral) — bydliště (neutral)");
  });

  it("renders alternative without synonyms (no dash)", () => {
    const result = renderTranslation(outputWithAlternatives, "en");
    const staveniLine = result.split("\n").find((l) => l.includes("stavení"));
    expect(staveniLine).toBe("   ∙ stavení (literary)");
  });

  it("renders alternatives before CEFR line", () => {
    const result = renderTranslation(outputWithAlternatives, "en");
    const altIdx = result.indexOf("∙ domov");
    const cefrIdx = result.indexOf("CEFR: A1");
    expect(altIdx).toBeGreaterThan(-1);
    expect(cefrIdx).toBeGreaterThan(altIdx);
  });

  it("does not render alternatives section when not present", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).not.toContain("∙");
  });

  it("does not render alternatives section when array is empty", () => {
    const outputEmpty: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations["cs"]!,
          alternatives: [],
        },
      },
    };
    const result = renderTranslation(outputEmpty, "en");
    expect(result).not.toContain("∙");
  });

  it("escapes HTML in alternative text and synonyms", () => {
    const xssAlternatives: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations["cs"]!,
          alternatives: [
            {
              text: "<b>bad</b>",
              register: "neutral",
              synonyms: [{ text: "a & b", register: "neutral" }],
            },
          ],
        },
      },
    };
    const result = renderTranslation(xssAlternatives, "en");
    expect(result).not.toContain("<b>bad</b>");
    expect(result).toContain("&lt;b&gt;bad&lt;/b&gt;");
    expect(result).toContain("a &amp; b");
  });
});

// ── Task 10: Idiomatic Equivalent Transparency Tests ────────────────

describe("renderTranslation — idiomatic equivalents", () => {
  const idiomaticOutput: TranslateOutput = {
    original: "Bez práce nejsou koláče",
    sourceLang: "cs",
    emoji: "🍰",
    register: "colloquial",
    translations: {
      en: {
        text: "No pain, no gain",
        cefr: "B1",
        register: "colloquial",
        expressionType: "idiomatic_equivalent",
        equivalentNote:
          "Closest English proverb conveying the same meaning",
        synonyms: [],
        examples: [
          {
            context: "colloquial",
            target: "No pain, no gain — you have to work for it.",
            native: "Bez práce nejsou koláče — musíš pro to pracovat.",
          },
        ],
      },
      de: {
        text: "Ohne Fleiß kein Preis",
        cefr: "B1",
        register: "neutral",
        expressionType: "idiomatic_equivalent",
        equivalentNote: "Deutsches Äquivalent mit gleicher Bedeutung",
        synonyms: [],
        examples: [],
      },
    },
  };

  it("renders idiomatic translations using the text field as before", () => {
    const result = renderTranslation(idiomaticOutput, "en");
    expect(result).toContain("<b>No pain, no gain</b>");
    expect(result).toContain("<b>Ohne Fleiß kein Preis</b>");
  });

  it("renders the original proverb in the header", () => {
    const result = renderTranslation(idiomaticOutput, "en");
    expect(result).toContain("🍰 <b>Bez práce nejsou koláče</b>");
  });

  it("does not leak expressionType or equivalentNote into output", () => {
    const result = renderTranslation(idiomaticOutput, "en");
    expect(result).not.toContain("idiomatic_equivalent");
    expect(result).not.toContain("equivalentNote");
    expect(result).not.toContain("expressionType");
  });

  it("renders examples from idiomatic translations normally", () => {
    const result = renderTranslation(idiomaticOutput, "en");
    expect(result).toContain(
      "<i>No pain, no gain — you have to work for it.</i>",
    );
    expect(result).toContain(
      "→ Bez práce nejsou koláče — musíš pro to pracovat.",
    );
  });

  it("handles mix of literal and idiomatic translations", () => {
    const mixedOutput: TranslateOutput = {
      ...idiomaticOutput,
      translations: {
        en: {
          text: "No pain, no gain",
          cefr: "B1",
          register: "colloquial",
          expressionType: "idiomatic_equivalent",
          equivalentNote: "English proverb equivalent",
          synonyms: [],
          examples: [],
        },
        fr: {
          text: "sans travail pas de gâteau",
          cefr: "B1",
          register: "neutral",
          expressionType: "literal",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTranslation(mixedOutput, "en");
    expect(result).toContain("<b>No pain, no gain</b>");
    expect(result).toContain("<b>sans travail pas de gâteau</b>");
  });
});

describe("renderTopicWord — idiomatic equivalents", () => {
  it("renders topic word with idiomatic fields transparently", () => {
    const idiomaticWord: TopicWord = {
      original: "The early bird catches the worm",
      translations: {
        cs: {
          text: "Ranní ptáče dál doskáče",
          cefr: "B1",
          register: "colloquial",
          expressionType: "idiomatic_equivalent",
          equivalentNote: "Czech proverb with same meaning",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTopicWord(idiomaticWord);
    expect(result).toContain(
      "<b>The early bird catches the worm</b>",
    );
    expect(result).toContain("<b>Ranní ptáče dál doskáče</b>");
    expect(result).not.toContain("idiomatic_equivalent");
    expect(result).not.toContain("equivalentNote");
  });
});
