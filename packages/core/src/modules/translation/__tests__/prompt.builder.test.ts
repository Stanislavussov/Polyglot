import { describe, it, expect } from "vitest";
import {
  buildTranslationPrompt,
  buildStrictPrompt,
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

  it("includes the source language", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("from en");
  });

  it("includes all target languages", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("to cs, de");
  });

  it("includes JSON structure template for each target language", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"cs"');
    expect(prompt).toContain('"de"');
    expect(prompt).toContain('"text"');
    expect(prompt).toContain('"cefr"');
    expect(prompt).toContain('"register"');
    expect(prompt).toContain('"synonyms"');
    expect(prompt).toContain('"examples"');
  });

  it("requests emoji in the output", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"emoji"');
  });

  it("specifies CEFR levels", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain("A1 | A2 | B1 | B2 | C1 | C2");
  });

  it("specifies register values", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain(
      "slang | colloquial | neutral | literary | professional",
    );
  });

  it("requests example contexts: formal, colloquial, professional", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"formal"');
    expect(prompt).toContain('"colloquial"');
    expect(prompt).toContain('"professional"');
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
    expect(prompt).toContain("to cs, de, fr, es");
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

  it("requests native sentence in source language", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain(`in en`);
  });

  it("includes alternatives structure in JSON template", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain('"alternatives"');
    expect(prompt).toContain("alternative translation 1");
    expect(prompt).toContain("alternative translation 2");
  });

  it("includes rule about 2 alternative translations", () => {
    const prompt = buildTranslationPrompt(baseRequest);
    expect(prompt).toContain(
      "Provide exactly 2 alternative translations per language",
    );
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
    expect(prompt).toContain("from en");
    expect(prompt).toContain("to cs");
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
});
