import { describe, it, expect, vi } from "vitest";
import { buildTranslationPrompt, buildStrictPrompt } from "../prompt.builder.js";
import {
  buildTranslationResultSchema,
  buildLanguageTranslationSchema,
} from "../schemas/translation.schema.js";
import { translate } from "../translation.service.js";
import {
  FULL_OUTPUT,
  MINIMAL_OUTPUT,
  NOTIFICATION_OUTPUT,
} from "../translation-output.presets.js";
import type { TranslationRequest, TranslateInput, TranslationOutputConfig } from "../types.js";

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
    cefr: "A1",
    register: "colloquial",
    synonyms: [{ text: "čau", register: "slang" }],
    examples: [
      { context: "formal", target: "Ahoj, jak se máš?", native: "Hello, how are you?" },
      { context: "colloquial", target: "Čau, co je?", native: "Hey, what's up?" },
      { context: "professional", target: "Dobrý den, vítejte.", native: "Good day, welcome." },
    ],
    ...overrides,
  };
}

// ─── Preset Tests ─────────────────────────────────────────

describe("presets", () => {
  it("FULL_OUTPUT has all fields set to true except includeExamples", () => {
    expect(FULL_OUTPUT).toEqual({
      includeExamples: false,
      includeTranscription: true,
      includeSynonyms: true,
      includeAlternatives: true,
      includeEquivalentNote: true,
    });
  });

  it("MINIMAL_OUTPUT has only includeTranscription: true, all others false", () => {
    expect(MINIMAL_OUTPUT).toEqual({
      includeExamples: false,
      includeTranscription: true,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
    });
  });

  it("NOTIFICATION_OUTPUT has includeExamples and includeTranscription true, others false", () => {
    expect(NOTIFICATION_OUTPUT).toEqual({
      includeExamples: true,
      includeTranscription: true,
      includeSynonyms: false,
      includeAlternatives: false,
      includeEquivalentNote: false,
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

  it("includeTranscription: false → prompt has no 'transcription' in language block", () => {
    const prompt = promptWith({ includeTranscription: false });
    expect(prompt).not.toContain('"transcription"');
    // Should also not have the transcription rule
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

  it("MINIMAL_OUTPUT preset → prompt has text, cefr, register, transcription but not examples/synonyms/alternatives/expressionType", () => {
    const prompt = promptWith(MINIMAL_OUTPUT);
    expect(prompt).toContain('"text"');
    expect(prompt).toContain('"cefr"');
    expect(prompt).toContain('"register"');
    expect(prompt).toContain('"transcription"');
    expect(prompt).not.toContain('"examples"');
    expect(prompt).not.toContain('"synonyms"');
    expect(prompt).not.toContain('"alternatives"');
    expect(prompt).not.toContain('"expressionType"');
  });
});

// ─── buildStrictPrompt config-aware Tests ─────────────────

describe("buildStrictPrompt with outputConfig", () => {
  it("includeExamples: false → strict prompt omits example variety check", () => {
    const prompt = buildStrictPrompt(
      { ...baseRequest, outputConfig: { includeExamples: false } },
      ["some error"],
    );
    expect(prompt).not.toContain("3 examples uses a DIFFERENT word");
  });

  it("includeEquivalentNote: false → strict prompt omits idiomatic expression check", () => {
    const prompt = buildStrictPrompt(
      { ...baseRequest, outputConfig: { includeEquivalentNote: false } },
      ["some error"],
    );
    expect(prompt).not.toContain("idiomatic_equivalent");
  });
});

// ─── Schema Builder Config-Aware Tests ────────────────────

describe("buildTranslationResultSchema with config", () => {
  it("includeExamples: false → schema accepts { examples: [] }", () => {
    const schema = buildTranslationResultSchema(["cs"], { includeExamples: false });
    const result = schema.safeParse({
      emoji: "👋",
      register: "neutral",
      translations: {
        cs: validLangEntry({ examples: [] }),
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
      register: "neutral",
      translations: { cs: entry },
    });
    expect(result.success).toBe(false);
  });

  it("includeSynonyms: false → schema accepts { synonyms: [] }", () => {
    const schema = buildTranslationResultSchema(["cs"], { includeSynonyms: false });
    const result = schema.safeParse({
      emoji: "👋",
      register: "neutral",
      translations: {
        cs: validLangEntry({ synonyms: [] }),
      },
    });
    expect(result.success).toBe(true);
  });

  it("default (no config) → schema still requires non-empty examples array (min 1)", () => {
    const schema = buildTranslationResultSchema(["cs"]);
    const result = schema.safeParse({
      emoji: "👋",
      register: "neutral",
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

  it("includeExamples: false → accepts empty examples", () => {
    const schema = buildLanguageTranslationSchema({ includeExamples: false });
    const result = schema.safeParse(validLangEntry({ examples: [] }));
    expect(result.success).toBe(true);
  });

  it("includeSynonyms: false → accepts empty synonyms", () => {
    const schema = buildLanguageTranslationSchema({ includeSynonyms: false });
    const result = schema.safeParse(validLangEntry({ synonyms: [] }));
    expect(result.success).toBe(true);
  });
});

// ─── Integration Test (service-level) ─────────────────────

describe("translate() with outputConfig", () => {
  it("passes outputConfig through to prompt and schema builders", async () => {
    const mockResult = {
      emoji: "👋",
      register: "neutral" as const,
      translations: {
        cs: {
          text: "ahoj",
          cefr: "A1" as const,
          register: "colloquial" as const,
          synonyms: [],
          examples: [],
          expressionType: "literal" as const,
        },
      },
    };

    const mockGenerate = vi.fn().mockResolvedValue(mockResult);

    const input: TranslateInput = {
      word: "hello",
      sourceLang: "en",
      targetLangs: ["cs"],
      model: "openai/gpt-4o",
      outputConfig: MINIMAL_OUTPUT,
    };

    const output = await translate(input, mockGenerate);

    // Verify the prompt was built without examples (MINIMAL_OUTPUT has includeExamples: false)
    const prompt = mockGenerate.mock.calls[0][0] as string;
    expect(prompt).not.toContain('"examples"');
    expect(prompt).not.toContain("VARIETY IN EXAMPLES");

    // Verify the schema accepted empty examples/synonyms (no validation error on them)
    expect(output.original).toBe("hello");
    expect(output.translations.cs.text).toBe("ahoj");
  });
});
