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

  it("names each target language code for the schema keys", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("(cs, de)");
    expect(prompt).toContain("translation text");
    expect(prompt).toContain("synonyms");
    expect(prompt).toContain("examples");
  });

  it("requests emoji in the output", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("emoji");
  });

  it("does not specify specific register values", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    // Register values are no longer constrained to specific enum
    expect(prompt).not.toContain("slang | colloquial | neutral | literary | professional");
  });

  it("requests flexible example contexts", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    // Examples now use flexible context labels instead of fixed neutral/colloquial/professional
    expect(prompt).toContain("exactly 3 short examples");
    expect(prompt).not.toContain('"context": "neutral"');
    expect(prompt).not.toContain('"context": "colloquial"');
    expect(prompt).not.toContain('"context": "professional"');
  });

  it("requests JSON only, no markdown", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("ONLY valid JSON");
    expect(prompt).toContain("No markdown");
  });

  it("includes topic hint when provided", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      topic: "medicine",
    });
    expect(prompt).toContain("medicine");
  });

  it("treats topic as a sense-selection hint, not source text", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      text: "bank",
      topic: "river",
    });

    expect(prompt).toContain("IMPORTANT - User Context Hint:");
    expect(prompt).toContain('The word should be understood in this context: "river".');
    expect(prompt).toContain(
      "The context hint is metadata for sense selection; do not translate it as part of the input.",
    );
    expect(prompt).toContain("Choose the meaning that best fits this context.");
    expect(prompt).toContain(
      "The requested fields (main translation, alternatives, synonyms, examples) must all fit this context.",
    );
  });

  it("does not mention context-bound fields disabled by output config", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      text: "bank",
      topic: "river",
      outputConfig: {
        includeAlternatives: false,
        includeSynonyms: false,
        includeExamples: false,
      },
    });

    expect(prompt).toContain("The requested fields (main translation) must all fit this context.");
    expect(prompt).not.toContain("main translation, alternatives");
    expect(prompt).not.toContain("synonyms, examples");
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
    expect(prompt).toContain("(cs)");
    expect(prompt).not.toContain("(cs, de)");
  });

  it("instructs same-language learning details when target includes source", () => {
    const prompt = buildTranslationPrompt({
      text: "ahoj",
      sourceLang: "cs",
      targetLangs: ["cs"],
      nativeLang: "ru",
    });
    expect(prompt).toContain("same as the source language");
    expect(prompt).toContain("same-language learning details/examples");
  });

  it("works with four target languages", () => {
    const prompt = buildTranslationPrompt({
      text: "world",
      sourceLang: "en",
      targetLangs: ["cs", "de", "fr", "es"],
    });
    expect(prompt).toContain("to Czech, German, French, Spanish");
    expect(prompt).toContain("(cs, de, fr, es)");
  });

  it("includes rule about variety in examples using different words", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("VARIETY IN EXAMPLES IS MANDATORY");
    expect(prompt).toContain("DIFFERENT word or expression");
    expect(prompt).toContain("use the main translation");
    expect(prompt).toContain("first alternative translation or a synonym");
    expect(prompt).toContain("second alternative translation or a different synonym");
  });

  it("does not request stale register labels for examples", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).not.toContain("register labels");
    expect(prompt).not.toContain('"register"');
  });

  it("requests native sentence in examples when native language is provided", () => {
    const prompt = buildTranslationPrompt({ ...baseRequest, nativeLang: "ru" });
    expect(prompt).toContain('"native"');
    expect(prompt).toContain("translated into Russian");
  });

  it("includes alternatives guidance when enabled", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("alternative translations");
  });

  it("includes rule about 2 alternative translations", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("Provide exactly 2 alternative translations per language");
  });

  it("includes connotation warning guidance (default config)", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("connotationWarning");
  });

  it("includes connotation warning rule about dangerous meanings", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('Use "connotationWarning" as target-side metadata only');
    expect(prompt).toContain('Omit "connotationWarning" when the target translation has no noteworthy');
    expect(prompt).toContain('Decide "connotationWarning" independently for each target language');
  });

  it("writes connotation warnings in the user's native language while describing the target translation", () => {
    const prompt = buildTranslationPrompt({ ...baseRequest, nativeLang: "ru" });
    expect(prompt).toContain("target-side connotation note written in Russian only when relevant");
    expect(prompt).toContain(
      'every "connotationWarning" value in every target language block MUST be written in Russian',
    );
    expect(prompt).toContain("MUST describe the target translation in that block");
  });

  it("prevents native-source connotation from explaining the source word", () => {
    const prompt = buildTranslationPrompt({
      text: "ябеда",
      sourceLang: "ru",
      targetLangs: ["cs", "en"],
      nativeLang: "ru",
    });
    expect(prompt).toContain("source language is the user's native language (Russian)");
    expect(prompt).toContain('NEVER use "connotationWarning" to explain the source word itself');
    expect(prompt).toContain("Assume the user already knows the source-language nuance");
  });

  it("does not apply the native-source connotation guard to learning-language source input", () => {
    const prompt = buildTranslationPrompt({
      text: "bonzák",
      sourceLang: "cs",
      targetLangs: ["cs", "en"],
      nativeLang: "ru",
    });
    expect(prompt).toContain('Use "connotationWarning" as target-side metadata only');
    expect(prompt).not.toContain("source language is the user's native language");
    expect(prompt).not.toContain("Assume the user already knows the source-language nuance");
  });

  it("does not require a native connotation warning language when nativeLang is absent", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).not.toContain("MUST be written in");
    expect(prompt).toContain("target-side connotation note only when relevant");
  });

  it("omits connotation warning when includeConnotationWarning is false", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      outputConfig: { includeConnotationWarning: false },
    });
    expect(prompt).not.toContain("connotation warning");
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

  it("includes native example check when native language is present", () => {
    const prompt = buildStrictPrompt({ ...baseRequest, nativeLang: "ru" }, ["error"]);
    expect(prompt).toContain("native translation of the target sentence");
  });

  it("includes connotation warning check in strict prompt", () => {
    const prompt = buildStrictPrompt(baseRequest, ["error"]);
    expect(prompt).toContain("connotationWarning is present only when the target translation has noteworthy");
    expect(prompt).toContain("is target-language specific");
  });

  it("includes native-language connotation warning check in strict prompt", () => {
    const prompt = buildStrictPrompt({ ...baseRequest, nativeLang: "ru" }, ["error"]);
    expect(prompt).toContain("is target-language specific and written in Russian");
  });

  it("includes native-source connotation check in strict prompt", () => {
    const prompt = buildStrictPrompt({ text: "ябеда", sourceLang: "ru", targetLangs: ["cs"], nativeLang: "ru" }, [
      "error",
    ]);
    expect(prompt).toContain("never as an explanation of the native source word");
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
    expect(prompt).not.toContain("synonyms");
    expect(prompt).not.toContain("alternative translations");
    expect(prompt).not.toContain("examples");
    expect(prompt).not.toContain('"expressionType"');
    expect(prompt).not.toContain("Idiomatic & Proverb Rule");
  });

  it("keeps transcription in sentence prompt (SENTENCE_OUTPUT has includeTranscription: true)", () => {
    const prompt = buildTranslationPrompt(sentenceRequest);
    expect(prompt).toContain("transcription");
  });

  it("topic hint says 'sentence' instead of 'word' for sentences", () => {
    const prompt = buildTranslationPrompt({ ...sentenceRequest, topic: "travel" });
    expect(prompt).toContain('The sentence should be understood in this context: "travel"');
    expect(prompt).not.toContain("The word should be understood");
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
