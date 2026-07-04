import { describe, expect, it, vi } from "vitest";
import {
  FULL_OUTPUT,
  MINIMAL_OUTPUT,
  NOTIFICATION_OUTPUT,
  RELIABLE_OUTPUT,
  SENTENCE_OUTPUT,
} from "../../../shared/translation-output.presets.js";
import { buildStrictPrompt, buildTranslationPrompt } from "../prompt.builder.js";
import { buildLanguageTranslationSchema, buildTranslationResultSchema } from "../schemas/translation.schema.js";
import { translate } from "../translation.service.js";
import type {
  TranslateInput,
  TranslateOutput,
  TranslationDecision,
  TranslationOutputConfig,
  TranslationRequest,
} from "../types.js";

function unwrap(d: TranslationDecision): TranslateOutput {
  if (!("output" in d)) throw new Error(`Unexpected needs_clarification: ${d.ambiguity.message}`);
  return d.output;
}

/** Create a mock generateObjectFn that auto-detects parallel call type from prompt content */
function createTranslateMock(result: Record<string, unknown>) {
  const { translations, ...metadata } = result;
  const langBlocks = (translations ?? {}) as Record<string, unknown>;
  return vi.fn().mockImplementation(async (prompt: string) => {
    if (prompt.includes("Do NOT include any translations")) return { ...metadata, nativeSynonyms: [] };
    for (const [lang, block] of Object.entries(langBlocks)) {
      if (prompt.includes(`translation block for language "${lang}"`)) return block;
    }
    return result;
  });
}

// ─── Helpers ──────────────────────────────────────────────

const baseRequest: TranslationRequest = {
  text: "hello",
  sourceLang: "en",
  targetLangs: ["cs"],
};

function promptWith(config: TranslationOutputConfig): string {
  return buildTranslationPrompt({ ...baseRequest, outputConfig: config });
}

function validLangEntry(overrides?: Record<string, unknown>) {
  return {
    text: "ahoj",
    synonyms: [{ text: "čau" }],
    examples: [
      { context: "neutral", target: "Ahoj, jak se máš?" },
      { context: "colloquial", target: "Čau, co je?" },
      { context: "professional", target: "Dobrý den, vítejte." },
    ],
    expressionType: null,
    equivalentNote: null,
    alternatives: null,
    connotationWarning: null,
    ...overrides,
  };
}

// ─── Preset Tests ─────────────────────────────────────────

describe("presets", () => {
  it("defines output presets without transcription fields", () => {
    expect(FULL_OUTPUT).toEqual({
      includeExamples: true,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: true,
      includeUsageNote: true,
      includeConnotationWarning: true,
      includeNativeSynonyms: true,
      includeGrammarBreakdown: true,
    });

    expect(MINIMAL_OUTPUT).toEqual({
      includeExamples: false,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeUsageNote: false,
      includeConnotationWarning: false,
      includeNativeSynonyms: false,
      includeGrammarBreakdown: false,
    });

    expect(RELIABLE_OUTPUT).toEqual({
      includeExamples: false,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeUsageNote: true,
      includeConnotationWarning: false,
      includeNativeSynonyms: false,
      includeGrammarBreakdown: false,
    });

    expect(NOTIFICATION_OUTPUT).toEqual({
      includeExamples: true,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeUsageNote: true,
      includeConnotationWarning: false,
      includeNativeSynonyms: false,
      includeGrammarBreakdown: false,
    });

    expect(SENTENCE_OUTPUT).toEqual({
      includeExamples: false,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
      includeUsageNote: false,
      includeConnotationWarning: false,
      includeNativeSynonyms: false,
      includeGrammarBreakdown: false,
    });
  });
});

// ─── Prompt Builder Config-Aware Tests ────────────────────

describe("buildTranslationPrompt with outputConfig", () => {
  it("includeExamples: false → prompt has no 'examples' key in JSON template", () => {
    const prompt = promptWith({ includeExamples: false });
    expect(prompt).not.toContain('"examples"');
  });

  it("includeExamples: false → prompt has no 'VARIETY IN EXAMPLES IS MANDATORY'", () => {
    const prompt = promptWith({ includeExamples: false });
    expect(prompt).not.toContain("VARIETY IN EXAMPLES IS MANDATORY");
  });

  it("includeExamples: false → prompt has no '3 example sentences'", () => {
    const prompt = promptWith({ includeExamples: false });
    expect(prompt).not.toContain("3 example sentences");
  });

  it("prompt never requests transcription and explicitly forbids pronunciation metadata", () => {
    const prompt = promptWith(FULL_OUTPUT);
    expect(prompt).not.toContain("transcription");
    expect(prompt).toContain("Do not include pronunciation, IPA, romanization, or transliteration in any field");
    expect(prompt).not.toContain("non-Latin scripts");
  });

  it("includeSynonyms: false → prompt has no 'synonyms' in language block", () => {
    const prompt = promptWith({ includeSynonyms: false });
    expect(prompt).not.toContain('"synonyms"');
  });

  it("includeSynonyms: false → prompt has no 'Provide 2–3 synonyms' rule", () => {
    const prompt = promptWith({ includeSynonyms: false });
    expect(prompt).not.toContain("2–3 synonyms");
  });

  it("includeAlternatives: false → prompt has no 'alternatives' in language block", () => {
    const prompt = promptWith({ includeAlternatives: false });
    expect(prompt).not.toContain('"alternatives"');
  });

  it("includeAlternatives: false → prompt has no '2 alternative translations' rule", () => {
    const prompt = promptWith({ includeAlternatives: false });
    expect(prompt).not.toContain("2 alternative translations");
  });

  it("includeEquivalentNote: false → prompt has no 'expressionType' in language block", () => {
    const prompt = promptWith({ includeEquivalentNote: false });
    expect(prompt).not.toContain('"expressionType"');
  });

  it("includeEquivalentNote: false → prompt has no 'Idiomatic & Proverb Rule' block", () => {
    const prompt = promptWith({ includeEquivalentNote: false });
    expect(prompt).not.toContain("Idiomatic & Proverb Rule");
  });

  it("empty config {} → prompt is identical to no-config call (all sections present)", () => {
    const withEmpty = buildTranslationPrompt({ ...baseRequest, outputConfig: {} });
    const withoutConfig = buildTranslationPrompt(baseRequest);
    expect(withEmpty).toBe(withoutConfig);
  });

  it("undefined config → prompt is identical to no-config call (all sections present)", () => {
    const withUndefined = buildTranslationPrompt({ ...baseRequest, outputConfig: undefined });
    const withoutConfig = buildTranslationPrompt(baseRequest);
    expect(withUndefined).toBe(withoutConfig);
  });

  it("MINIMAL_OUTPUT preset → prompt includes only translation text", () => {
    const prompt = promptWith(MINIMAL_OUTPUT);
    expect(prompt).toContain("translation text");
    expect(prompt).not.toContain('"register"');
    expect(prompt).not.toContain('"examples"');
    expect(prompt).not.toContain('"synonyms"');
    expect(prompt).not.toContain('"alternatives"');
    expect(prompt).not.toContain('"expressionType"');
    expect(prompt).not.toContain('"connotationWarning"');
  });

  it("FULL_OUTPUT preset → prompt includes examples, connotationWarning, and all enabled sections", () => {
    const prompt = promptWith(FULL_OUTPUT);
    expect(prompt).toContain("translation text");
    expect(prompt).toContain("synonyms");
    expect(prompt).toContain("alternative translations");
    expect(prompt).toContain("examples");
    expect(prompt).toContain("connotationWarning");
    expect(prompt).toContain("VARIETY IN EXAMPLES IS MANDATORY");
    expect(prompt).toContain("target-side metadata");
  });

  it("includeConnotationWarning: false → prompt has no 'connotationWarning' field", () => {
    const prompt = promptWith({ includeConnotationWarning: false });
    expect(prompt).not.toContain('"connotationWarning"');
    expect(prompt).not.toContain("dangerous or misleading connotations");
  });

  it("includeConnotationWarning: true → prompt has 'connotationWarning' field and warning rule", () => {
    const prompt = promptWith({ includeConnotationWarning: true });
    expect(prompt).toContain("connotationWarning");
    expect(prompt).toContain('Use "connotationWarning" as target-side metadata only');
  });
});

// ─── buildStrictPrompt config-aware Tests ─────────────────

describe("buildStrictPrompt with outputConfig", () => {
  it("includeExamples: false → strict prompt omits example variety check", () => {
    const prompt = buildStrictPrompt({ ...baseRequest, outputConfig: { includeExamples: false } }, ["some error"]);
    expect(prompt).not.toContain("3 examples uses a DIFFERENT word");
  });

  it("includeEquivalentNote: false → strict prompt omits idiomatic expression check", () => {
    const prompt = buildStrictPrompt({ ...baseRequest, outputConfig: { includeEquivalentNote: false } }, [
      "some error",
    ]);
    expect(prompt).not.toContain("idiomatic_equivalent");
  });

  it("includeConnotationWarning: false → strict prompt omits connotation warning check", () => {
    const prompt = buildStrictPrompt({ ...baseRequest, outputConfig: { includeConnotationWarning: false } }, [
      "some error",
    ]);
    expect(prompt).not.toContain("connotationWarning is present ONLY");
  });

  it("includeConnotationWarning: true → strict prompt includes connotation warning check", () => {
    const prompt = buildStrictPrompt({ ...baseRequest, outputConfig: { includeConnotationWarning: true } }, [
      "some error",
    ]);
    expect(prompt).toContain("connotationWarning is present only when the target translation has noteworthy");
  });
});

// ─── Schema Builder Config-Aware Tests ────────────────────

describe("buildTranslationResultSchema with config", () => {
  it("includeExamples: false → schema accepts missing examples", () => {
    const schema = buildTranslationResultSchema(["cs"], { includeExamples: false });
    const entry = validLangEntry();
    delete (entry as Record<string, unknown>).examples;
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [],
      translations: {
        cs: entry,
      },
    });
    expect(result.success).toBe(true);
  });

  it("includeExamples: false → schema still rejects missing 'text' field", () => {
    const schema = buildTranslationResultSchema(["cs"], { includeExamples: false });
    const entry = validLangEntry({ examples: [] });
    delete (entry as Record<string, unknown>).text;
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [],
      translations: { cs: entry },
    });
    expect(result.success).toBe(false);
  });

  it("includeSynonyms: false → schema accepts missing synonyms", () => {
    const schema = buildTranslationResultSchema(["cs"], { includeSynonyms: false });
    const entry = validLangEntry();
    delete (entry as Record<string, unknown>).synonyms;
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [],
      translations: {
        cs: entry,
      },
    });
    expect(result.success).toBe(true);
  });

  it("default (no config) → schema still requires non-empty examples array (min 1)", () => {
    const schema = buildTranslationResultSchema(["cs"]);
    const result = schema.safeParse({
      emoji: "👋",
      nativeSynonyms: [],
      translations: {
        cs: validLangEntry({ examples: [] }),
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("buildLanguageTranslationSchema", () => {
  it("default → requires at least 1 example", () => {
    const schema = buildLanguageTranslationSchema();
    const result = schema.safeParse(validLangEntry({ examples: [] }));
    expect(result.success).toBe(false);
  });

  it("includeExamples: false → accepts missing examples", () => {
    const schema = buildLanguageTranslationSchema({ includeExamples: false });
    const entry = validLangEntry();
    delete (entry as Record<string, unknown>).examples;
    const result = schema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("includeSynonyms: false → accepts missing synonyms", () => {
    const schema = buildLanguageTranslationSchema({ includeSynonyms: false });
    const entry = validLangEntry();
    delete (entry as Record<string, unknown>).synonyms;
    const result = schema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("connotationWarning is optional in schema (always)", () => {
    const schema = buildLanguageTranslationSchema();
    const resultWithWarning = schema.safeParse(
      validLangEntry({ connotationWarning: "to arouse — sexual connotation" }),
    );
    const resultWithout = schema.safeParse(validLangEntry());
    expect(resultWithWarning.success).toBe(true);
    expect(resultWithout.success).toBe(true);
  });
});

// ─── Integration Test (service-level) ─────────────────────

describe("translate() with outputConfig", () => {
  it("passes outputConfig through to prompt and schema builders", async () => {
    const mockResult = {
      emoji: "👋",
      translations: {
        cs: {
          text: "ahoj",
          synonyms: [],
          examples: [],
          expressionType: "literal" as const,
        },
      },
    };

    const mockGenerate = createTranslateMock(mockResult);

    const input: TranslateInput = {
      word: "hello",
      sourceLang: "en",
      targetLangs: ["cs"],
      model: "openai/gpt-4o",
      outputConfig: MINIMAL_OUTPUT,
    };

    const output = await translate(input, mockGenerate);

    // Verify the language prompt was built without examples (MINIMAL_OUTPUT has includeExamples: false)
    const langPrompt = mockGenerate.mock.calls[1][0] as string;
    expect(langPrompt).not.toContain('"examples"');
    expect(langPrompt).not.toContain("VARIETY IN EXAMPLES");

    // Verify the schema accepted empty examples/synonyms (no validation error on them)
    expect(unwrap(output).original).toBe("hello");
    expect(unwrap(output).translations.cs.text).toBe("ahoj");
  });
});

describe("translate() with SENTENCE_OUTPUT and inputType=sentence", () => {
  it("passes inputType through to prompt builder and validation", async () => {
    const mockResult = {
      emoji: "🏥",
      translations: {
        de: {
          text: "Können Sie mir sagen, wo die nächste Apotheke ist?",
          synonyms: [],
          examples: [],
          expressionType: "literal" as const,
        },
      },
    };

    const mockGenerate = createTranslateMock(mockResult);

    const input: TranslateInput = {
      word: "Can you tell me where the nearest pharmacy is?",
      sourceLang: "en",
      targetLangs: ["de"],
      model: "openai/gpt-4o",
      outputConfig: SENTENCE_OUTPUT,
      inputType: "sentence",
    };

    const output = await translate(input, mockGenerate);

    // Verify the language prompt uses sentence-style intro
    const langPrompt = mockGenerate.mock.calls[1][0] as string;
    expect(langPrompt).toContain("Translate the following sentence");
    expect(langPrompt).not.toContain('"synonyms"');
    expect(langPrompt).not.toContain('"alternatives"');
    expect(langPrompt).not.toContain('"examples"');

    // Verify result is returned correctly
    expect(unwrap(output).original).toBe("Can you tell me where the nearest pharmacy is?");
    expect(unwrap(output).translations.de.text).toBe("Können Sie mir sagen, wo die nächste Apotheke ist?");
    expect(unwrap(output).translations.de.synonyms).toEqual([]);
    expect(unwrap(output).translations.de.examples).toEqual([]);
  });

  it("sentence translation strips disabled fields from AI response", async () => {
    const mockResult = {
      emoji: "🏥",
      translations: {
        de: {
          text: "Wo ist die Apotheke?",
          // AI may still return these even when not asked
          synonyms: [{ text: "Drogerie" }],
          examples: [],
          equivalentNote: "should be stripped",
          expressionType: "literal" as const,
          connotationWarning: null,
        },
      },
    };

    const mockGenerate = createTranslateMock(mockResult);

    const input: TranslateInput = {
      word: "Where is the pharmacy?",
      sourceLang: "en",
      targetLangs: ["de"],
      model: "openai/gpt-4o",
      outputConfig: SENTENCE_OUTPUT,
      inputType: "sentence",
    };

    const output = await translate(input, mockGenerate);

    // SENTENCE_OUTPUT disables synonyms, alternatives, equivalentNote
    expect(unwrap(output).translations.de.synonyms).toEqual([]);
    expect(unwrap(output).translations.de.alternatives).toBeNull();
    expect(unwrap(output).translations.de.equivalentNote).toBeNull();
    expect(unwrap(output).translations.de.expressionType).toBeNull();
    // Transcription is still included (not disabled)
  });
});
