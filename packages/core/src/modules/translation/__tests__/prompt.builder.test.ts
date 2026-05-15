import { describe, expect, it } from "vitest";
import { buildStrictPrompt, buildTranslationPrompt } from "../prompt.builder.js";
import { SENTENCE_OUTPUT } from "../translation-output.presets.js";
import type { TranslationRequest } from "../types.js";

describe("buildTranslationPrompt", () => {
  const baseRequest: TranslationRequest = {
    text: "hello",
    sourceLang: "en",
    targetLangs: ["cs", "de"],
  };

  it("includes the word to translate", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"hello"');
  });

  it("includes the source language as full name", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("from English");
  });

  it("includes all target languages as full names", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("to Czech, German");
  });

  it("includes JSON structure template for each target language", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"cs"');
    expect(prompt).toContain('"de"');
    expect(prompt).toContain('"text"');
    expect(prompt).toContain('"register"');
    expect(prompt).toContain('"synonyms"');
    expect(prompt).toContain('"examples"');
  });

  it("requests emoji in the output", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"emoji"');
  });

  it("does not specify specific register values", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    // Register values are no longer constrained to specific enum
    expect(prompt).not.toContain("slang | colloquial | neutral | literary | professional");
  });

  it("requests flexible example contexts", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    // Examples now use flexible context labels instead of fixed neutral/colloquial/professional
    expect(prompt).toContain('"context": "<context label>"');
    expect(prompt).not.toContain('"context": "neutral"');
    expect(prompt).not.toContain('"context": "colloquial"');
    expect(prompt).not.toContain('"context": "professional"');
  });

  it("requests JSON only, no markdown", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("ONLY valid JSON");
    expect(prompt).toContain("no markdown");
  });

  it("includes topic hint when provided", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      topic: "medicine",
    });
    expect(prompt).toContain("medicine");
  });

  it("does not include topic hint when not provided", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).not.toContain("context of:");
  });

  it("works with a single target language", () => {
    const prompt = buildTranslationPrompt({
      text: "world",
      sourceLang: "en",
      targetLangs: ["cs"],
    });
    expect(prompt).toContain('"cs"');
    expect(prompt).not.toContain('"de"');
  });

  it("works with four target languages", () => {
    const prompt = buildTranslationPrompt({
      text: "world",
      sourceLang: "en",
      targetLangs: ["cs", "de", "fr", "es"],
    });
    expect(prompt).toContain("to Czech, German, French, Spanish");
    expect(prompt).toContain('"cs"');
    expect(prompt).toContain('"de"');
    expect(prompt).toContain('"fr"');
    expect(prompt).toContain('"es"');
  });

  it("includes rule about variety in examples using different words", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("VARIETY IN EXAMPLES IS MANDATORY");
    expect(prompt).toContain("DIFFERENT word or expression");
    expect(prompt).toContain("use the main translation");
    expect(prompt).toContain("first alternative translation or a synonym");
    expect(prompt).toContain("second alternative translation or a different synonym");
  });

  it("includes register label instruction for examples in source language", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("register label in English, one word");
    expect(prompt).toContain("ONE-WORD label in English");
  });

  it("does not request native sentence in examples (removed for token savings)", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    // The old format had: "native": "<same sentence in English>"
    expect(prompt).not.toContain('"native"');
  });

  it("includes alternatives structure in JSON template", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"alternatives"');
    expect(prompt).toContain("alternative translation 1");
    expect(prompt).toContain("alternative translation 2");
  });

  it("includes rule about 2 alternative translations", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("Provide exactly 2 alternative translations per language");
  });

  it("includes connotation warning field in JSON template (default config)", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"connotationWarning"');
  });

  it("includes connotation warning rule about dangerous meanings", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("Warn about dangerous or misleading connotations ONLY if they exist");
    expect(prompt).toContain("Most words should NOT have a warning");
  });

  it("omits connotation warning when includeConnotationWarning is false", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      outputConfig: { includeConnotationWarning: false },
    });
    expect(prompt).not.toContain('"connotationWarning"');
    expect(prompt).not.toContain("dangerous or misleading connotations");
  });
});

describe("buildStrictPrompt", () => {
  const baseRequest: TranslationRequest = {
    text: "hello",
    sourceLang: "en",
    targetLangs: ["cs"],
  };

  it("includes the base prompt", () => {
    const prompt = buildStrictPrompt(baseRequest, ["some error"]);
    expect(prompt).toContain('"hello"');
    expect(prompt).toContain("from English");
    expect(prompt).toContain("to Czech");
  });

  it("includes error feedback", () => {
    const errors = [
      "[semantic] Translation is identical to original",
      "[examples] Example 0 does not contain the word",
    ];
    const prompt = buildStrictPrompt(baseRequest, errors);
    expect(prompt).toContain("Translation is identical to original");
    expect(prompt).toContain("Example 0 does not contain the word");
  });

  it("mentions validation errors header", () => {
    const prompt = buildStrictPrompt(baseRequest, ["error"]);
    expect(prompt).toContain("previous response had validation errors");
  });

  it("includes correction guidance", () => {
    const prompt = buildStrictPrompt(baseRequest, ["error"]);
    expect(prompt).toContain("fix these issues");
    expect(prompt).toContain("Double-check");
  });

  it("includes register label check for examples", () => {
    const prompt = buildStrictPrompt(baseRequest, ["error"]);
    expect(prompt).toContain("one-word register label");
  });

  it("includes connotation warning check in strict prompt", () => {
    const prompt = buildStrictPrompt(baseRequest, ["error"]);
    expect(prompt).toContain("connotationWarning is present ONLY for words with genuinely dangerous");
  });
});

// ─── Sentence-aware prompt Tests ──────────────────────────

describe("buildTranslationPrompt with inputType=sentence", () => {
  const sentenceRequest: TranslationRequest = {
    text: "Can you tell me where the nearest pharmacy is?",
    sourceLang: "en",
    targetLangs: ["cs", "de"],
    outputConfig: SENTENCE_OUTPUT,
    inputType: "sentence",
  };

  it("uses 'Translate the following sentence' intro for sentences", () => {
    const prompt = buildTranslationPrompt(sentenceRequest);
    expect(prompt).toContain("Translate the following sentence from English to Czech, German:");
    expect(prompt).toContain('"Can you tell me where the nearest pharmacy is?"');
  });

  it("does not use 'Translate \"...\"' format for sentences", () => {
    const prompt = buildTranslationPrompt(sentenceRequest);
    // The word-style format wraps text inline: Translate "text" from ...
    // Sentence format puts text on the next line after a colon
    expect(prompt).not.toMatch(/^Translate "Can you tell me/m);
  });

  it("omits synonyms, alternatives, examples, equivalentNote (via SENTENCE_OUTPUT)", () => {
    const prompt = buildTranslationPrompt(sentenceRequest);
    expect(prompt).not.toContain('"synonyms"');
    expect(prompt).not.toContain('"alternatives"');
    expect(prompt).not.toContain('"examples"');
    expect(prompt).not.toContain('"expressionType"');
    expect(prompt).not.toContain("Idiomatic & Proverb Rule");
  });

  it("keeps transcription in sentence prompt (SENTENCE_OUTPUT has includeTranscription: true)", () => {
    const prompt = buildTranslationPrompt(sentenceRequest);
    expect(prompt).toContain('"transcription"');
  });

  it("topic hint says 'sentence' instead of 'word' for sentences", () => {
    const prompt = buildTranslationPrompt({ ...sentenceRequest, topic: "travel" });
    expect(prompt).toContain('The sentence is used in the context of: "travel"');
    expect(prompt).not.toContain("The word is used");
  });
});

describe("buildTranslationPrompt with inputType=word (backward compat)", () => {
  const wordRequest: TranslationRequest = {
    text: "hello",
    sourceLang: "en",
    targetLangs: ["cs"],
    inputType: "word",
  };

  it("uses standard 'Translate \"...\"' format for words", () => {
    const prompt = buildTranslationPrompt(wordRequest);
    expect(prompt).toContain('Translate "hello" from English to Czech.');
  });
});

describe("buildTranslationPrompt with inputType absent (backward compat)", () => {
  const noTypeRequest: TranslationRequest = {
    text: "hello",
    sourceLang: "en",
    targetLangs: ["cs"],
  };

  it("uses standard 'Translate \"...\"' format when inputType is absent", () => {
    const prompt = buildTranslationPrompt(noTypeRequest);
    expect(prompt).toContain('Translate "hello" from English to Czech.');
  });
});

describe("buildStrictPrompt with inputType=sentence", () => {
  const sentenceRequest: TranslationRequest = {
    text: "Where is the train station?",
    sourceLang: "en",
    targetLangs: ["de"],
    outputConfig: SENTENCE_OUTPUT,
    inputType: "sentence",
  };

  it("strict prompt also uses sentence-style intro", () => {
    const prompt = buildStrictPrompt(sentenceRequest, ["some error"]);
    expect(prompt).toContain("Translate the following sentence from English to German:");
  });

  it("strict prompt includes error feedback for sentences", () => {
    const prompt = buildStrictPrompt(sentenceRequest, ["[schema] missing text field"]);
    expect(prompt).toContain("missing text field");
    expect(prompt).toContain("previous response had validation errors");
  });
});
