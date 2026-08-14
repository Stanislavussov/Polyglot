import type { TemplateFields, TopicWord, TranslateOutput } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildTranslationKeyboard,
  renderQualityWarning,
  renderSentenceTranslation as renderSentenceTranslationRaw,
  renderTopicWord,
  renderTranslation as renderTranslationRaw,
} from "../renderers/translation.renderer.js";

// Mock getLangFlag from @polyglot/core
vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  const flagMap: Record<string, string> = {
    en: "🇬🇧",
    cs: "🇨🇿",
    de: "🇩🇪",
    fr: "🇫🇷",
    es: "🇪🇸",
    ru: "🇷🇺",
    it: "🇮🇹",
    pt: "🇵🇹",
    uk: "🇺🇦",
    pl: "🇵🇱",
  };
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => flagMap[code]),
  };
});

/**
 * These cases predate language ordering and assert content, not sequence — most
 * use a single-language fixture. They render through an empty ordering context so
 * each call site stays unchanged; ordering itself is covered by the dedicated
 * suites (core's translation-order tests and the per-surface order tests).
 */
const NO_ORDER = createLanguageOrderContext({ learningLangs: [] });

const renderTranslation = (
  output: TranslateOutput,
  interfaceLang?: string,
  templateFields?: TemplateFields,
  nativeLang?: string,
  needsReview?: boolean,
  grammarBreakdown?: Record<string, string[]>,
  etymology?: string,
): string =>
  renderTranslationRaw(
    output,
    NO_ORDER,
    interfaceLang,
    templateFields,
    nativeLang,
    needsReview,
    grammarBreakdown,
    etymology,
  );

const renderSentenceTranslation = (
  output: TranslateOutput,
  interfaceLang?: string,
  nativeLang?: string,
  needsReview?: boolean,
  grammarBreakdown?: Record<string, string[]>,
): string => renderSentenceTranslationRaw(output, NO_ORDER, interfaceLang, nativeLang, needsReview, grammarBreakdown);

const sampleOutput: TranslateOutput = {
  original: "hello",
  sourceLang: "en",
  emoji: "👋",
  nativeMeaning: "A greeting.",
  nativeSynonyms: [{ text: "привет" }],
  translations: {
    cs: {
      text: "ahoj",
      synonyms: [{ text: "dobrý den" }, { text: "nazdar" }],
      examples: [
        { context: "neutral", target: "Dobrý den, pane!" },
        { context: "colloquial", target: "Ahoj, jak se máš?" },
        { context: "professional", target: "Dobrý den, kolegové." },
      ],
    },
  },
};

describe("renderTranslation", () => {
  it("renders header with emoji and original word", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("👋 🇬🇧 <b>hello</b>");
  });

  it("renders native meaning under the original with native language label", () => {
    const result = renderTranslation(sampleOutput, "en", undefined, "ru");
    expect(result).toContain("🇷🇺 RU: A greeting.");
  });

  it("does NOT render native meaning when nativeLang equals sourceLang", () => {
    const result = renderTranslation(sampleOutput, "en", undefined, "en");
    expect(result).not.toContain("🇬🇧 EN:");
    expect(result).not.toContain("A greeting.");
  });

  it("does not render register label (disabled to save tokens)", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).not.toContain("Register:");
  });

  it("renders language code in uppercase with flag from DB", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("🇨🇿 CS:");
  });

  it("renders translation text as bold", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("<b>ahoj</b>");
  });

  it("renders translation text without transcription", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("<b>ahoj</b>");
    expect(result).not.toContain("[");
  });

  it("renders synonyms inline after translation header", () => {
    const result = renderTranslation(sampleOutput, "en");
    // Synonyms are inline: text only, no register, no separate block
    expect(result).not.toContain("Synonyms:");
    expect(result).toContain("(dobrý den, nazdar)");
  });

  it("renders examples with 💬 icon", () => {
    const result = renderTranslation(sampleOutput, "en");
    // All examples use 💬 icon, no per-context icons, no register labels
    expect(result).not.toContain("📎");
    expect(result).not.toContain("💼");
    expect(result).toContain("💬 <i>Dobrý den, pane!</i>");
    expect(result).toContain("💬 <i>Ahoj, jak se máš?</i>");
    expect(result).toContain("💬 <i>Dobrý den, kolegové.</i>");
  });

  it("renders native example translation in parentheses when present", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          examples: [{ context: "colloquial", target: "Ahoj, jak se máš?", native: "Привет, как дела?" }],
        },
      },
    };
    const result = renderTranslation(output, "ru");
    expect(result).toContain("💬 <i>Ahoj, jak se máš?</i> (Привет, как дела?)");
  });

  it("escapes HTML in native example translation", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          examples: [{ context: "neutral", target: "Target", native: "A < B & C" }],
        },
      },
    };
    const result = renderTranslation(output, "en");
    expect(result).toContain("(A &lt; B &amp; C)");
  });

  it("renders example sentences in italic", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("<i>Dobrý den, pane!</i>");
  });

  it("does NOT render native translation — only target language", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).not.toContain("Hello, sir!");
    expect(result).not.toContain("Hello, how are you?");
    expect(result).not.toContain("Hello, colleagues.");
  });

  it("does not show needsReview when false", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).not.toContain("inaccuracies");
  });

  it("shows needsReview warning when true", () => {
    const result = renderTranslation(sampleOutput, "en", undefined, undefined, true);
    expect(result).toContain("inaccuracies");
  });

  it("renders in Russian when interfaceLang is ru", () => {
    const result = renderTranslation(sampleOutput, "ru");
    expect(result).not.toContain("Регистр:");
    // Synonyms are inline, no section headers
    expect(result).not.toContain("Синонимы:");
    expect(result).not.toContain("Примеры:");
    // Inline synonyms still present
    expect(result).toContain("(dobrý den, nazdar)");
  });

  it("falls back to en for unknown interfaceLang", () => {
    const result = renderTranslation(sampleOutput, "xx");
    // Inline synonyms still work with fallback
    expect(result).toContain("(dobrý den, nazdar)");
  });

  it("renders without transcription when absent", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).toContain("🇨🇿 CS: <b>ahoj</b>");
  });

  it("renders without inline synonyms when empty", () => {
    const noSynonyms: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          synonyms: [],
        },
      },
    };
    const result = renderTranslation(noSynonyms, "en");
    // No parenthetical after translation
    const csLine = result.split("\n").find((l) => l.includes("CS:"));
    expect(csLine).not.toContain("(");
  });

  it("renders without examples when empty", () => {
    const noExamples: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          examples: [],
        },
      },
    };
    const result = renderTranslation(noExamples, "en");
    expect(result).not.toContain("💬");
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

  it("renders multiple target languages with their flags", () => {
    const multiLang: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: sampleOutput.translations.cs!,
        de: {
          text: "hallo",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTranslation(multiLang, "en");
    expect(result).toContain("🇨🇿 CS:");
    expect(result).toContain("🇩🇪 DE:");
    expect(result).toContain("<b>hallo</b>");
  });

  it("falls back to 🔤 when getLangFlag returns undefined", () => {
    // "xx" is not in the flag map, so getLangFlag returns undefined
    const unknownLang: TranslateOutput = {
      ...sampleOutput,
      translations: {
        xx: {
          text: "test",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTranslation(unknownLang, "en");
    expect(result).toContain("🔤 XX:");
  });

  it("renders source usage for learning-language source words", () => {
    const output: TranslateOutput = {
      original: "kudlanka",
      sourceLang: "cs",
      emoji: "🪲",
      nativeMeaning: "Богомол; название насекомого.",
      sourceUsage: {
        explanation:
          "Так называют насекомое; слово нейтральное и обычно используется в бытовом или биологическом контексте.",
        synonyms: [{ text: "nábožná kudlanka" }],
        examples: [{ context: "nature", target: "Na zahradě seděla kudlanka.", native: "В саду сидел богомол." }],
      },
      nativeSynonyms: [{ text: "богомол" }],
      translations: {
        ru: {
          text: "богомол",
          synonyms: [{ text: "богомоловые" }],
          examples: [],
        },
        en: {
          text: "mantis",
          synonyms: [{ text: "praying mantis" }],
          examples: [{ context: "neutral", target: "I saw a mantis.", native: "Я увидел богомола." }],
        },
      },
    };

    const result = renderTranslation(output, "ru", undefined, "ru");

    expect(result).toContain("🪲 🇨🇿 <b>kudlanka</b> (nábožná kudlanka)");
    expect(result).toContain("🇷🇺 RU: <b>богомол</b> (богомоловые)");
    expect(result).toContain("💡 Так называют насекомое");
    expect(result).toContain("💬 <i>Na zahradě seděla kudlanka.</i> (В саду сидел богомол.)");
    expect(result).toContain("🇬🇧 EN: <b>mantis</b> (praying mantis)");
  });

  it("does not render a separate native translation block when native target is in sourceUsage", () => {
    const output: TranslateOutput = {
      original: "kudlanka",
      sourceLang: "cs",
      emoji: "🪲",
      sourceUsage: {
        explanation: "Так называют насекомое.",
        synonyms: [],
        examples: [],
      },
      nativeSynonyms: [],
      translations: {
        ru: { text: "богомол", synonyms: [], examples: [] },
        en: { text: "mantis", synonyms: [], examples: [] },
      },
    };

    const result = renderTranslation(output, "ru", undefined, "ru");

    const ruHeaderMatches = result.match(/🇷🇺 RU: <b>богомол<\/b>/g);
    expect(ruHeaderMatches).toHaveLength(1);
  });

  it("falls back to explanation-only when native translation is absent (legacy)", () => {
    const output: TranslateOutput = {
      original: "kudlanka",
      sourceLang: "cs",
      emoji: "🪲",
      nativeMeaning: "Богомол; название насекомого.",
      sourceUsage: {
        explanation:
          "Так называют насекомое; слово нейтральное и обычно используется в бытовом или биологическом контексте.",
        synonyms: [{ text: "nábožná kudlanka" }],
        examples: [{ context: "nature", target: "Na zahradě seděla kudlanka.", native: "В саду сидел богомол." }],
      },
      nativeSynonyms: [{ text: "богомол" }],
      translations: {
        en: {
          text: "mantis",
          synonyms: [{ text: "praying mantis" }],
          examples: [{ context: "neutral", target: "I saw a mantis.", native: "Я увидел богомола." }],
        },
      },
    };

    const result = renderTranslation(output, "ru", undefined, "ru");

    expect(result).toContain("🪲 🇨🇿 <b>kudlanka</b> (nábožná kudlanka)");
    expect(result).toContain("🇷🇺 RU: Так называют насекомое");
    expect(result).toContain("💬 <i>Na zahradě seděla kudlanka.</i> (В саду сидел богомол.)");
    expect(result).toContain("🇬🇧 EN: <b>mantis</b> (praying mantis)");
  });

  it("respects template fields for source usage synonyms and examples", () => {
    const output: TranslateOutput = {
      original: "kudlanka",
      sourceLang: "cs",
      emoji: "🪲",
      sourceUsage: {
        explanation: "Богомол; нейтральное название насекомого.",
        synonyms: [{ text: "nábožná kudlanka" }],
        examples: [{ context: "nature", target: "Na zahradě seděla kudlanka.", native: "В саду сидел богомол." }],
      },
      nativeSynonyms: [],
      translations: {
        en: {
          text: "mantis",
          synonyms: [],
          examples: [],
        },
      },
    };

    const result = renderTranslation(
      output,
      "ru",
      {
        synonyms: false,
        examples: false,
        alternatives: true,
        equivalentNote: true,
        connotationWarning: true,
        grammarBreakdown: false,
      },
      "ru",
    );

    expect(result).toContain("🪲 🇨🇿 <b>kudlanka</b>");
    expect(result).not.toContain("nábožná kudlanka");
    expect(result).not.toContain("Na zahradě seděla kudlanka");
  });
});

describe("renderTopicWord", () => {
  const sampleWord: TopicWord = {
    original: "apple",
    translations: {
      cs: {
        text: "jablko",
        synonyms: [],
        examples: [],
      },
      de: {
        text: "Apfel",
        synonyms: [],
        examples: [],
      },
    },
  };

  it("renders original word as bold header", () => {
    const result = renderTopicWord(sampleWord);
    expect(result).toContain("<b>apple</b>");
  });

  it("renders translations with language flags from DB", () => {
    const result = renderTopicWord(sampleWord);
    expect(result).toContain("🇨🇿 CS: <b>jablko</b>");
    expect(result).toContain("🇩🇪 DE:");
  });

  it("falls back to 🔤 in topic word when getLangFlag returns undefined", () => {
    const unknownWord: TopicWord = {
      original: "test",
      translations: {
        zz: {
          text: "test",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTopicWord(unknownWord);
    expect(result).toContain("🔤 ZZ:");
  });

  it("renders translation text without transcription", () => {
    const result = renderTopicWord(sampleWord);
    expect(result).toContain("🇨🇿 CS: <b>jablko</b>");
    expect(result).toContain("🇩🇪 DE: <b>Apfel</b>");
    expect(result).not.toContain("[");
  });

  it("escapes HTML in word text", () => {
    const xssWord: TopicWord = {
      original: "<b>bad</b>",
      translations: {
        cs: {
          text: "špatný & zlý",
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
  const cbData = (btn: unknown): string | undefined => (btn as { callback_data?: string }).callback_data;
  const lastRow = (kb: ReturnType<typeof buildTranslationKeyboard>) =>
    kb.inline_keyboard[kb.inline_keyboard.length - 1]!;

  it("has clarify and other meaning buttons in the first row", () => {
    const kb = buildTranslationKeyboard("en", 42);
    const actionRow = kb.inline_keyboard[0]!;
    expect(actionRow).toHaveLength(2);
    expect(cbData(actionRow[0])).toBe("tr:clarifypost:42");
    expect(cbData(actionRow[1])).toBe("tr:altmeaning:42");
  });

  it("renames the clarify button to 'Clarify meaning'", () => {
    const kb = buildTranslationKeyboard("en", 42);
    const clarifyBtn = kb.inline_keyboard[0]![0]!;
    expect(clarifyBtn.text).toContain("Clarify meaning");
  });

  it("uses 'Уточнить значение' for the clarify button in ru locale", () => {
    const kb = buildTranslationKeyboard("ru", 42);
    const clarifyBtn = kb.inline_keyboard[0]![0]!;
    expect(clarifyBtn.text).toContain("Уточнить значение");
  });

  it("pins the save button to the last row", () => {
    const kb = buildTranslationKeyboard("en", 42);
    const saveRow = lastRow(kb);
    expect(saveRow).toHaveLength(1);
    expect(cbData(saveRow[0])).toBe("tr:save:42");
  });

  it("keeps save last even with grammar and etymology rows present", () => {
    const kb = buildTranslationKeyboard("en", 42, false, true, false, true);
    const saveRow = lastRow(kb);
    expect(saveRow).toHaveLength(1);
    expect(cbData(saveRow[0])).toBe("tr:save:42");
  });

  it("has exactly 2 rows when no learning aids are shown", () => {
    const kb = buildTranslationKeyboard("en", 42);
    expect(kb.inline_keyboard).toHaveLength(2);
  });

  it("places grammar and etymology together on a shared row", () => {
    const kb = buildTranslationKeyboard("en", 42, false, true, false, true);
    const aidRow = kb.inline_keyboard[1]!;
    expect(aidRow).toHaveLength(2);
    expect(cbData(aidRow[0])).toBe("tr:grammar:42");
    expect(cbData(aidRow[1])).toBe("tr:etymology:42");
  });

  it("shows the etymology button alone when grammar is hidden (single word)", () => {
    const kb = buildTranslationKeyboard("en", 42, false, false, false, true);
    const aidRow = kb.inline_keyboard[1]!;
    expect(aidRow).toHaveLength(1);
    expect(cbData(aidRow[0])).toBe("tr:etymology:42");
    // rows: actions, etymology, save
    expect(kb.inline_keyboard).toHaveLength(3);
  });

  it("shows disabled save button when isAlreadySaved is true", () => {
    const kb = buildTranslationKeyboard("en", 0, true);
    const saveBtn = lastRow(kb)[0]!;
    expect(saveBtn.text).toContain("Saved");
    expect(cbData(saveBtn)).toBe("tr:save:0");
  });

  it("shows active save button when isAlreadySaved is false", () => {
    const kb = buildTranslationKeyboard("en", 0, false);
    const saveBtn = lastRow(kb)[0]!;
    expect(saveBtn.text).toContain("Save");
    expect(cbData(saveBtn)).toBe("tr:save:0");
  });

  it("falls back to en for unknown interface language", () => {
    const kb = buildTranslationKeyboard("xx");
    const saveBtn = lastRow(kb)[0]!;
    expect(saveBtn.text).toContain("Save");
  });

  it("uses Russian labels for ru locale", () => {
    const kb = buildTranslationKeyboard("ru", 0);
    const saveBtn = lastRow(kb)[0]!;
    expect(saveBtn.text).toContain("Сохранить");
  });

  it("defaults msgId to 0 when not provided", () => {
    const kb = buildTranslationKeyboard("en");
    expect(cbData(lastRow(kb)[0])).toBe("tr:save:0");
  });

  it("omits the source-override rows when no override languages are given", () => {
    const kb = buildTranslationKeyboard("en", 42);
    const hasOverride = kb.inline_keyboard.some((row) => row.some((b) => cbData(b)?.startsWith("tr:srclang:")));
    expect(hasOverride).toBe(false);
  });

  it("omits the source-override rows when the override language list is empty", () => {
    const kb = buildTranslationKeyboard("en", 42, false, false, false, false, []);
    const hasOverride = kb.inline_keyboard.some((row) => row.some((b) => cbData(b)?.startsWith("tr:srclang:")));
    expect(hasOverride).toBe(false);
  });

  it("renders a 'translate from' header and one flag button per override language", () => {
    const kb = buildTranslationKeyboard("en", 42, false, false, false, false, ["de", "fr"]);
    const flat = kb.inline_keyboard.flat();
    // The header is a non-actionable NOOP button labelled from the interface locale.
    const header = flat.find((b) => cbData(b) === "noop");
    expect(header?.text).toContain("Translate from");
    expect(cbData(flat.find((b) => (b as { text?: string }).text?.includes("DE")))).toBe("tr:srclang:de:42");
    expect(cbData(flat.find((b) => (b as { text?: string }).text?.includes("FR")))).toBe("tr:srclang:fr:42");
  });

  it("keeps the save button last even with the source-override rows present", () => {
    const kb = buildTranslationKeyboard("en", 42, false, false, false, false, ["de", "fr"]);
    const saveRow = lastRow(kb);
    expect(saveRow).toHaveLength(1);
    expect(cbData(saveRow[0])).toBe("tr:save:42");
  });

  it("wraps override flag buttons into rows of at most four", () => {
    const kb = buildTranslationKeyboard("en", 42, false, false, false, false, ["de", "fr", "es", "it", "pl"]);
    const flagRows = kb.inline_keyboard.filter((row) => row.every((b) => cbData(b)?.startsWith("tr:srclang:")));
    expect(flagRows[0]).toHaveLength(4);
    expect(flagRows[1]).toHaveLength(1);
  });
});

describe("renderTranslation — etymology section", () => {
  it("renders the etymology section when provided", () => {
    const result = renderTranslation(
      sampleOutput,
      "ru",
      undefined,
      "ru",
      false,
      undefined,
      "Из латинского corpus — тело.",
    );
    expect(result).toContain("🔍 Этимология");
    expect(result).toContain("Из латинского corpus — тело.");
  });

  it("does not render an etymology section when absent", () => {
    const result = renderTranslation(sampleOutput, "ru", undefined, "ru");
    expect(result).not.toContain("🔍 Этимология");
  });

  it("escapes HTML in etymology prose", () => {
    const result = renderTranslation(sampleOutput, "en", undefined, "ru", false, undefined, "from <i>x</i> & y");
    expect(result).toContain("from &lt;i&gt;x&lt;/i&gt; &amp; y");
    expect(result).not.toContain("<i>x</i>");
  });

  it("renders etymology after the grammar breakdown section", () => {
    const result = renderTranslation(
      sampleOutput,
      "ru",
      undefined,
      "ru",
      false,
      { cs: ["nějaká konstrukce — пояснение"] },
      "Происхождение слова.",
    );
    const grammarIdx = result.indexOf("nějaká konstrukce");
    const etymologyIdx = result.indexOf("Происхождение слова.");
    expect(grammarIdx).toBeGreaterThan(-1);
    expect(etymologyIdx).toBeGreaterThan(grammarIdx);
  });
});

// ── Alternatives rendering tests ────────────────────────────────────

describe("renderTranslation — alternatives", () => {
  const outputWithAlternatives: TranslateOutput = {
    original: "house",
    sourceLang: "en",
    emoji: "🏠",
    nativeSynonyms: [],
    translations: {
      cs: {
        text: "dům",
        synonyms: [],
        examples: [{ context: "neutral", target: "Dům je velký." }],
        alternatives: [
          {
            text: "domov",
            synonyms: [{ text: "bydliště" }],
          },
          {
            text: "stavení",
            synonyms: [],
          },
        ],
      },
    },
  };

  it("renders alternative without synonyms (no dash)", () => {
    const result = renderTranslation(outputWithAlternatives, "en");
    const staveniLine = result.split("\n").find((l) => l.includes("stavení"));
    expect(staveniLine).toBe("   ∙ stavení");
  });

  it("renders alternatives after main translation header", () => {
    const result = renderTranslation(outputWithAlternatives, "en");
    const headerIdx = result.indexOf("CS:");
    const altIdx = result.indexOf("∙ domov");
    expect(headerIdx).toBeGreaterThan(-1);
    expect(altIdx).toBeGreaterThan(headerIdx);
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
          ...sampleOutput.translations.cs!,
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
          ...sampleOutput.translations.cs!,
          alternatives: [
            {
              text: "<b>bad</b>",
              synonyms: [{ text: "a & b" }],
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
    nativeSynonyms: [],
    translations: {
      en: {
        text: "No pain, no gain",
        expressionType: "idiomatic_equivalent",
        equivalentNote: "Closest English proverb conveying the same meaning",
        synonyms: [],
        examples: [
          {
            context: "colloquial",
            target: "No pain, no gain — you have to work for it.",
          },
        ],
      },
      de: {
        text: "Ohne Fleiß kein Preis",
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
    expect(result).toContain("🍰 🇨🇿 <b>Bez práce nejsou koláče</b>");
  });

  it("does not leak expressionType or equivalentNote into output", () => {
    const result = renderTranslation(idiomaticOutput, "en");
    expect(result).not.toContain("idiomatic_equivalent");
    expect(result).not.toContain("equivalentNote");
    expect(result).not.toContain("expressionType");
  });

  it("renders examples from idiomatic translations", () => {
    const result = renderTranslation(idiomaticOutput, "en");
    // No native sentence rendered
    expect(result).not.toContain("Bez práce nejsou koláče — musíš pro to pracovat.");
    expect(result).not.toContain("→");
  });

  it("handles mix of literal and idiomatic translations", () => {
    const mixedOutput: TranslateOutput = {
      ...idiomaticOutput,
      translations: {
        en: {
          text: "No pain, no gain",
          expressionType: "idiomatic_equivalent",
          equivalentNote: "English proverb equivalent",
          synonyms: [],
          examples: [],
        },
        fr: {
          text: "sans travail pas de gâteau",
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
          expressionType: "idiomatic_equivalent",
          equivalentNote: "Czech proverb with same meaning",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderTopicWord(idiomaticWord);
    expect(result).toContain("<b>The early bird catches the worm</b>");
    expect(result).toContain("<b>Ranní ptáče dál doskáče</b>");
    expect(result).not.toContain("idiomatic_equivalent");
    expect(result).not.toContain("equivalentNote");
  });
});

// ── Task 31: Connotation warning tests ──────────────────────────

describe("renderTranslation — connotation warnings", () => {
  it("renders regular usage guidance with a distinct marker", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs,
          usageNote: "Нейтральное разговорное приветствие.",
          connotationWarning: "Может быть слишком неформальным в официальной переписке.",
        },
      },
    };

    const result = renderTranslation(output, "ru");

    expect(result).toContain("💡 Нейтральное разговорное приветствие.");
    expect(result).toContain("ℹ️ Может быть слишком неформальным в официальной переписке.");
  });

  it("renders connotation warning when present", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          connotationWarning: "to arouse — sexual connotation",
        },
      },
    };
    const result = renderTranslation(output, "en");
    expect(result).toContain("ℹ️ to arouse — sexual connotation");
  });

  it("does not render connotation warning when absent", () => {
    const result = renderTranslation(sampleOutput, "en");
    expect(result).not.toContain("ℹ️");
  });

  it("does not render connotation warning when field is undefined", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          connotationWarning: undefined,
        },
      },
    };
    const result = renderTranslation(output, "en");
    expect(result).not.toContain("ℹ️");
  });

  it("renders connotation warning after examples", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          connotationWarning: "potentially offensive",
        },
      },
    };
    const result = renderTranslation(output, "en");
    const lastExampleIdx = result.lastIndexOf("💬");
    const warningIdx = result.indexOf("ℹ️");
    expect(warningIdx).toBeGreaterThan(lastExampleIdx);
  });

  it("escapes HTML in connotation warning text", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          connotationWarning: "danger <b>bold</b> & special",
        },
      },
    };
    const result = renderTranslation(output, "en");
    expect(result).toContain("ℹ️ danger &lt;b&gt;bold&lt;/b&gt; &amp; special");
  });

  it("uses i18n connotationWarning key with locale", () => {
    const output: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          connotationWarning: "warning text",
        },
      },
    };
    // All locales use same informational format "ℹ️ {warning}"
    const resultEn = renderTranslation(output, "en");
    const resultRu = renderTranslation(output, "ru");
    expect(resultEn).toContain("ℹ️ warning text");
    expect(resultRu).toContain("ℹ️ warning text");
  });
});

// ── Task 31: Backward compatibility with old Example format ─────

describe("renderTranslation — backward compat with old examples", () => {
  it("gracefully handles old examples without register field", () => {
    const oldFormatOutput: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          // Simulate old data from DB that has no native field
          examples: [{ context: "neutral", target: "Old example sentence." }],
        },
      },
    };
    const result = renderTranslation(oldFormatOutput, "en");
    // Should render without register label, no crash
    expect(result).toContain("💬 <i>Old example sentence.</i>");
    expect(result).not.toContain("→");
  });

  it("renders native field from examples when present", () => {
    const oldFormatOutput: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          examples: [{ context: "neutral", target: "Good day!", native: "Добрый день!" }],
        },
      },
    };
    const result = renderTranslation(oldFormatOutput, "en");
    expect(result).toContain("💬 <i>Good day!</i> (Добрый день!)");
  });
});

// ── Task 31: Inline synonyms rendering tests ────────────────────

describe("renderTranslation — inline synonyms", () => {
  it("shows synonyms inline after translation text", () => {
    const result = renderTranslation(sampleOutput, "en");
    // Header line should contain inline synonyms
    const csLine = result.split("\n").find((l) => l.includes("CS:"));
    expect(csLine).toContain("<b>ahoj</b> (dobrý den, nazdar)");
  });

  it("shows no parenthetical when zero synonyms", () => {
    const noSyn: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: { ...sampleOutput.translations.cs!, synonyms: [] },
      },
    };
    const result = renderTranslation(noSyn, "en");
    const csLine = result.split("\n").find((l) => l.includes("CS:"));
    expect(csLine).toBe("🇨🇿 CS: <b>ahoj</b>");
  });

  it("shows single synonym in parenthetical", () => {
    const oneSyn: TranslateOutput = {
      ...sampleOutput,
      translations: {
        cs: {
          ...sampleOutput.translations.cs!,
          synonyms: [{ text: "dobrý den" }],
        },
      },
    };
    const result = renderTranslation(oneSyn, "en");
    const csLine = result.split("\n").find((l) => l.includes("CS:"));
    expect(csLine).toContain("(dobrý den)");
  });
});

// ── Task 27: Sentence translation rendering tests ────────────────

const sentenceOutput: TranslateOutput = {
  original: "Can you tell me where the nearest pharmacy is?",
  sourceLang: "en",
  emoji: "💊",
  nativeMeaning: "A question asking for the location of the closest pharmacy.",
  nativeSynonyms: [],
  translations: {
    cs: {
      text: "Můžete mi říct, kde je nejbližší lékárna?",
      synonyms: [],
      examples: [],
    },
    de: {
      text: "Können Sie mir sagen, wo die nächste Apotheke ist?",
      synonyms: [],
      examples: [],
    },
  },
};

describe("renderSentenceTranslation", () => {
  it("renders emoji and original sentence as bold header", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).toContain("💊 🇬🇧 <b>Can you tell me where the nearest pharmacy is?</b>");
  });

  it("renders native meaning for sentence translations", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en", "ru");
    expect(result).toContain("🇷🇺 RU: A question asking for the location of the closest pharmacy.");
  });

  it("does NOT render native meaning when nativeLang equals sourceLang", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en", "en");
    expect(result).not.toContain("🇬🇧 EN:");
    expect(result).not.toContain("A question asking for the location of the closest pharmacy.");
  });

  it("renders translation text as bold per language", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).toContain("<b>Můžete mi říct, kde je nejbližší lékárna?</b>");
    expect(result).toContain("<b>Können Sie mir sagen, wo die nächste Apotheke ist?</b>");
  });

  it("renders sentence translations without transcription", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).toContain("🇨🇿 CS: <b>Můžete mi říct, kde je nejbližší lékárna?</b>");
    expect(result).toContain("🇩🇪 DE: <b>Können Sie mir sagen, wo die nächste Apotheke ist?</b>");
    expect(result).not.toContain("[");
  });

  it("renders language flags from DB", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).toContain("🇨🇿 CS:");
    expect(result).toContain("🇩🇪 DE:");
  });

  it("does NOT render synonyms", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).not.toContain("Synonyms:");
  });

  it("does NOT render examples", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).not.toContain("Examples:");
    expect(result).not.toContain("📎");
    expect(result).not.toContain("💬");
    expect(result).not.toContain("💼");
  });

  it("does NOT render alternatives", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).not.toContain("∙");
  });

  it("does NOT render register line", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).not.toContain("Register:");
  });

  it("shows needsReview warning when true", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en", undefined, true);
    expect(result).toContain("inaccuracies");
  });

  it("does not show needsReview when false", () => {
    const result = renderSentenceTranslation(sentenceOutput, "en");
    expect(result).not.toContain("inaccuracies");
  });

  it("escapes HTML special characters", () => {
    const xss: TranslateOutput = {
      ...sentenceOutput,
      original: "<script>alert('xss')</script>",
    };
    const result = renderSentenceTranslation(xss, "en");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("falls back to en for unknown interfaceLang", () => {
    const result = renderSentenceTranslation(sentenceOutput, "xx");
    // Should not throw
    expect(result).toContain("💊");
  });

  it("falls back to 🔤 when getLangFlag returns undefined", () => {
    const unknownLang: TranslateOutput = {
      ...sentenceOutput,
      translations: {
        xx: {
          text: "test",
          synonyms: [],
          examples: [],
        },
      },
    };
    const result = renderSentenceTranslation(unknownLang, "en");
    expect(result).toContain("🔤 XX:");
  });
});

/* buildSentenceKeyboard and buildPostSaveKeyboard removed — unified into buildTranslationKeyboard */

// ── renderQualityWarning (Task 37.9) ──

describe("renderQualityWarning", () => {
  it("renders quality warning in English", () => {
    const result = renderQualityWarning("en");
    expect(result).toContain("quality uncertain");
  });

  it("renders quality warning in Russian", () => {
    const result = renderQualityWarning("ru");
    expect(result).toContain("⚠️");
  });

  it("renders quality warning in Czech", () => {
    const result = renderQualityWarning("cs");
    expect(result).toContain("⚠️");
  });

  it("falls back to English for unknown lang", () => {
    const result = renderQualityWarning("xx");
    expect(result).toContain("quality uncertain");
  });

  it("escapes HTML in warning text", () => {
    const result = renderQualityWarning("en");
    expect(result).not.toContain("<script>");
  });

  it("is different from translationNeedsReview text", () => {
    const qualityWarning = renderQualityWarning("en");
    const translationCard = renderTranslation(sampleOutput, "en", undefined, undefined, true);
    // Both contain ⚠️ but have different text
    expect(qualityWarning).toContain("quality uncertain");
    expect(translationCard).toContain("inaccuracies");
    expect(qualityWarning).not.toContain("inaccuracies");
  });
});

describe("input correction annotations (Task 69)", () => {
  it("shows a ✏️ Fixed line with original → corrected — explanation for a word auto-fix", () => {
    const card = renderTranslation(
      {
        ...sampleOutput,
        correction: { original: "helllo", corrected: "hello", explanation: "extra letter removed" },
      },
      "en",
    );

    expect(card).toContain("✏️");
    expect(card).toContain("helllo");
    expect(card).toContain("extra letter removed");
    // The corrected headword still renders below the notice.
    expect(card).toContain("<b>hello</b>");
  });

  it("renders no correction notice when the input was not corrected", () => {
    expect(renderTranslation(sampleOutput, "en")).not.toContain("✏️");
  });

  it("shows the corrected sentence and error explanation on a sentence card", () => {
    const card = renderSentenceTranslation(
      {
        original: "I go to school",
        sourceLang: "en",
        emoji: "📝",
        nativeSynonyms: [],
        translations: { cs: { text: "Chodím do školy", synonyms: [], examples: [] } },
        correction: {
          original: "i go too school",
          corrected: "I go to school",
          explanation: "«too» should be «to»",
        },
      },
      "en",
      "ru",
    );

    expect(card).toContain("✏️");
    expect(card).toContain("I go to school");
    expect(card).toContain("«too» should be «to»");
  });
});
