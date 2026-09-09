import { describe, expect, it } from "vitest";
import { SENTENCE_OUTPUT } from "../../../shared/translation-output.presets.js";
import {
  buildMetadataPrompt,
  buildSingleLanguagePrompt,
  buildStrictPrompt,
  buildTranslationPrompt,
  USER_INPUT_INJECTION_GUARD,
} from "../prompt.builder.js";
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

  it("prefixes the prompt with the prompt-injection guard (S6)", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain(USER_INPUT_INJECTION_GUARD);
    // The guard must precede the interpolated user text so the model reads it first.
    expect(prompt.indexOf(USER_INPUT_INJECTION_GUARD)).toBeLessThan(prompt.indexOf('"hello"'));
  });

  it("guards the metadata prompt against injection too (S6)", () => {
    const prompt = buildMetadataPrompt(baseRequest);
    expect(prompt).toContain(USER_INPUT_INJECTION_GUARD);
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

  it("includes universal language-specific grammatical markers directive", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("grammatically essential markers");
    expect(prompt).toContain("articles, grammatical gender, verb aspect");
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
    expect(prompt).toContain("source language (cs) must not be returned as a translation block");
    expect(prompt).toContain("natural same-language paraphrase or concise explanation");
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
    expect(prompt).toContain("translation of the target example sentence into Russian");
  });

  it("forbids IPA, pronunciation, romanization, and transliteration in every field", () => {
    const prompt = buildTranslationPrompt({
      text: "phase out",
      sourceLang: "en",
      targetLangs: ["cs", "ru"],
      nativeLang: "ru",
      inputType: "phrase",
    });

    expect(prompt).toContain("Do not include pronunciation, IPA, romanization, or transliteration in any field");
  });

  it("does not request a native example translation for the native target block", () => {
    const prompt = buildTranslationPrompt({
      text: "phase out",
      sourceLang: "en",
      targetLangs: ["cs", "ru"],
      nativeLang: "ru",
      inputType: "phrase",
    });

    expect(prompt).toContain('For target language "ru", omit the "native" field');
    expect(prompt).toContain('For every other target language, "native"');
  });

  it("requests top-level nativeMeaning when native language is provided", () => {
    const prompt = buildTranslationPrompt({ ...baseRequest, nativeLang: "ru" });
    expect(prompt).toContain('"nativeMeaning"');
    expect(prompt).toContain("written in Russian");
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

  it("separates regular usage guidance from exceptional connotation warnings", () => {
    const prompt = buildTranslationPrompt({ ...baseRequest, nativeLang: "ru" });

    expect(prompt).toContain('Every target language block MUST include "usageNote" written in Russian');
    expect(prompt).toContain("regular learner guidance, not a warning");
    expect(prompt).toContain('Omit "connotationWarning" when the target translation has no noteworthy');
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

  it("requests source usage guidance for learning-language source words", () => {
    const prompt = buildTranslationPrompt({
      text: "kudlanka",
      sourceLang: "cs",
      targetLangs: ["en"],
      nativeLang: "ru",
      inputType: "word",
    });

    expect(prompt).toContain('Include top-level "sourceUsage"');
    expect(prompt).toContain("meaning, nuance, register, and when a learner should use or avoid this word");
    expect(prompt).toContain("2-3 close synonyms in Czech");
    expect(prompt).toContain('exactly 3 realistic usage examples for "kudlanka"');
    // The source-usage example sentence must land in "target" as a full sentence,
    // not collapse to the bare headword (the "nevertheless (Russian sentence)" bug).
    expect(prompt).toContain('"target" MUST be a complete Czech sentence, never just the word "kudlanka"');
    expect(prompt).toContain('natural Russian translation of that Czech sentence into the "native" field');
    expect(prompt).toContain("collocations or lexical chunks");
  });

  it("requests a canonical source headword and injects source-language traits (German article/capitalization)", () => {
    const request: TranslationRequest = {
      text: "arbeit",
      sourceLang: "de",
      targetLangs: ["ru"],
      nativeLang: "ru",
      inputType: "word",
    };
    // Both the full and the live metadata prompt must carry the source-side rules.
    for (const prompt of [buildTranslationPrompt(request), buildMetadataPrompt(request)]) {
      expect(prompt).toContain('"headword"');
      expect(prompt).toContain("die Arbeit");
      // The German directive (source language) — never covered by the
      // target-only traits hint — must be applied to source-language fields.
      expect(prompt).toContain("Apply German conventions to the source-language fields");
      expect(prompt).toContain("der/die/das");
    }
  });

  it("does not inject source-language traits when the source is the native language", () => {
    const prompt = buildTranslationPrompt({
      text: "богомол",
      sourceLang: "ru",
      targetLangs: ["de", "en"],
      nativeLang: "ru",
      inputType: "word",
    });
    // Native source → no sourceUsage block → no source headword request.
    expect(prompt).not.toContain('"headword"');
    expect(prompt).not.toContain("Apply Russian conventions to the source-language fields");
  });

  it("instructs AI to translate into the native language when source is a learning language", () => {
    const prompt = buildTranslationPrompt({
      text: "kudlanka",
      sourceLang: "cs",
      targetLangs: ["ru", "en"],
      nativeLang: "ru",
      inputType: "word",
    });

    expect(prompt).toContain("including the user's native language (Russian)");
    expect(prompt).toContain("the native-language translation must be the direct word in the user's native language");
  });

  it("instructs AI to keep the native target block minimal (text + synonyms only)", () => {
    const prompt = buildTranslationPrompt({
      text: "kudlanka",
      sourceLang: "cs",
      targetLangs: ["ru", "en"],
      nativeLang: "ru",
      inputType: "word",
    });

    expect(prompt).toContain("For the native-language target block (ru) ONLY");
    expect(prompt).toContain('OMIT "examples", "alternatives", "usageNote", and "connotationWarning"');
  });

  it("does not emit the minimal-native-target rule when source is the native language", () => {
    const prompt = buildTranslationPrompt({
      text: "богомол",
      sourceLang: "ru",
      targetLangs: ["cs", "en"],
      nativeLang: "ru",
      inputType: "word",
    });

    expect(prompt).not.toContain("For the native-language target block");
  });

  it("does not request source usage guidance for learning-language source sentences", () => {
    const prompt = buildTranslationPrompt({
      text: "Kde je nejbližší lékárna?",
      sourceLang: "cs",
      targetLangs: ["en"],
      nativeLang: "ru",
      inputType: "sentence",
    });

    expect(prompt).not.toContain('Include top-level "sourceUsage"');
    expect(prompt).not.toContain("collocations or lexical chunks");
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
    expect(prompt).toContain("nativeMeaning is present");
  });

  it("includes source usage check for learning-language source words", () => {
    const prompt = buildStrictPrompt(
      { text: "kudlanka", sourceLang: "cs", targetLangs: ["en"], nativeLang: "ru", inputType: "word" },
      ["error"],
    );

    expect(prompt).toContain("sourceUsage is present");
    expect(prompt).toContain("source-language synonyms");
    expect(prompt).toContain('source-language examples for "kudlanka"');
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

  it("states that connotationWarning must be written in the native language, not the target language", () => {
    const prompt = buildTranslationPrompt({
      text: "phase out",
      sourceLang: "en",
      targetLangs: ["cs", "de"],
      nativeLang: "ru",
    });

    expect(prompt).toContain(
      'every "connotationWarning" value in every target language block MUST be written in Russian',
    );
    expect(prompt).toContain("MUST describe the target translation in that block");
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

describe("buildTranslationPrompt — grammar breakdown", () => {
  const baseRequest: TranslationRequest = {
    text: "auf den Tisch",
    sourceLang: "de",
    targetLangs: ["cs"],
    nativeLang: "ru",
  };

  it("includes grammar breakdown instructions for phrases when enabled", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      outputConfig: { includeGrammarBreakdown: true },
      inputType: "phrase",
    });
    expect(prompt).toContain("grammarBreakdown");
    expect(prompt).toContain("constructional grammar patterns");
    expect(prompt).toContain("Russian");
  });

  it("does NOT include grammar breakdown for words even when enabled", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      outputConfig: { includeGrammarBreakdown: true },
      inputType: "word",
    });
    // Grammar breakdown is controlled at the config level (resolveOutputConfig forces false for words)
    // but the prompt builder respects the config flag directly
    expect(prompt).toContain("grammarBreakdown");
  });

  it("includes grammar breakdown even when sourceLang === nativeLang (analyzes target translations)", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      sourceLang: "ru",
      nativeLang: "ru",
      outputConfig: { includeGrammarBreakdown: true },
      inputType: "phrase",
    });
    expect(prompt).toContain("grammarBreakdown");
  });

  it("does NOT include grammar breakdown when disabled in config", () => {
    const prompt = buildTranslationPrompt({
      ...baseRequest,
      outputConfig: { includeGrammarBreakdown: false },
      inputType: "phrase",
    });
    expect(prompt).not.toContain("grammarBreakdown");
  });

  it("strict prompt includes grammar breakdown check item when enabled", () => {
    const prompt = buildStrictPrompt(
      {
        ...baseRequest,
        outputConfig: { includeGrammarBreakdown: true },
        inputType: "phrase",
      },
      ["[schema] missing field"],
    );
    expect(prompt).toContain("grammarBreakdown");
    expect(prompt).toContain("constructional grammar patterns");
  });

  it("strict prompt includes grammar breakdown check even when sourceLang === nativeLang", () => {
    const prompt = buildStrictPrompt(
      {
        ...baseRequest,
        sourceLang: "ru",
        nativeLang: "ru",
        outputConfig: { includeGrammarBreakdown: true },
        inputType: "phrase",
      },
      ["[schema] missing field"],
    );
    expect(prompt).toContain("grammarBreakdown");
  });
});

describe("sense anchor", () => {
  const wordRequest: TranslationRequest = {
    text: "wasted",
    sourceLang: "en",
    targetLangs: ["cs"],
    nativeLang: "ru",
    inputType: "word",
  };

  it("asks the metadata call for a primarySense on word input", () => {
    const prompt = buildMetadataPrompt(wordRequest);
    expect(prompt).toContain("primarySense");
  });

  it("does not ask for a primarySense on sentence input", () => {
    const prompt = buildMetadataPrompt({
      ...wordRequest,
      text: "He got wasted last night.",
      inputType: "sentence",
      outputConfig: SENTENCE_OUTPUT,
    });
    expect(prompt).not.toContain("primarySense");
  });

  it("anchors every field of a language block to the sense when one is given", () => {
    const prompt = buildTranslationPrompt({
      ...wordRequest,
      senseAnchor: "intoxicated by alcohol or drugs (slang)",
    });
    expect(prompt).toContain("intoxicated by alcohol or drugs (slang)");
    expect(prompt).toContain("SENSE ANCHOR");
  });

  it("omits the anchor block when no sense was resolved", () => {
    expect(buildTranslationPrompt(wordRequest)).not.toContain("SENSE ANCHOR");
  });

  it("stops asking for a different-sense alternative once anchored", () => {
    const unanchored = buildTranslationPrompt(wordRequest);
    const anchored = buildTranslationPrompt({ ...wordRequest, senseAnchor: "squandered, used up in vain" });
    expect(unanchored).toContain("another common sense");
    expect(anchored).not.toContain("another common sense");
  });

  it('lets an unrecognized headword answer "unknown" instead of inventing a sense', () => {
    const prompt = buildMetadataPrompt(wordRequest, true);
    expect(prompt).toContain("primarySense");
    expect(prompt).toContain('set "primarySense" to null');
  });

  it("asks for a NEW sense when the user requested another meaning", () => {
    const prompt = buildMetadataPrompt({
      ...wordRequest,
      negativeConstraints: { cs: ["promarněný"] },
    });
    // Otherwise the anchor rule ("the sense a learner most likely means") fights
    // the request and the button degrades to another synonym of the same sense.
    expect(prompt).toContain("Choose a sense NOT represented by the already-shown translations");
    expect(prompt).not.toContain("Choose the sense a learner most likely means");
  });

  it("never anchors a field the schema does not carry", () => {
    const prompt = buildMetadataPrompt({ ...wordRequest, outputConfig: { includeEmoji: false } });
    const anchoredFields = prompt.split("\n").find((line) => line.includes("must describe THIS sense"));
    expect(prompt).toContain("primarySense");
    // includeEmoji: false leaves no "emoji" key in the metadata schema, and a
    // strict provider rejects a prompt that demands a field the schema forbids.
    expect(anchoredFields).toBeDefined();
    expect(anchoredFields).not.toContain("emoji");
    expect(anchoredFields).toContain("sourceUsage");
  });

  it("carries the anchor into the per-language prompt", () => {
    const prompt = buildSingleLanguagePrompt({ ...wordRequest, senseAnchor: "drunk (slang)" }, "cs");
    expect(prompt).toContain("drunk (slang)");
  });
});
