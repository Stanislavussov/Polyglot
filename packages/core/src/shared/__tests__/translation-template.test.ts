import { describe, expect, it } from "vitest";
import { RELIABLE_OUTPUT, SENTENCE_OUTPUT } from "../translation-output.presets.js";
import { resolveOutputConfig, resolveTemplate } from "../translation-template.service.js";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_FIELD_KEYS,
  templateToOutputConfig,
  type UserTranslationTemplate,
} from "../translation-template.types.js";

describe("DEFAULT_TEMPLATE", () => {
  it("has learner-friendly default fields for words and phrases", () => {
    expect(DEFAULT_TEMPLATE).toEqual({
      name: "Default",
      fields: {
        synonyms: true,
        examples: false,
        alternatives: true,
        equivalentNote: false,
        connotationWarning: false,
      },
    });
  });
});

describe("TEMPLATE_FIELD_KEYS", () => {
  it("contains all field keys in display order", () => {
    expect(TEMPLATE_FIELD_KEYS).toEqual([
      "synonyms",
      "examples",
      "alternatives",
      "equivalentNote",
      "connotationWarning",
    ]);
  });
});

describe("templateToOutputConfig", () => {
  it("converts default template to learner-friendly output", () => {
    expect(templateToOutputConfig(DEFAULT_TEMPLATE)).toEqual({
      ...RELIABLE_OUTPUT,
      includeSynonyms: true,
      includeAlternatives: true,
      includeNativeSynonyms: true,
    });
  });

  it("maps template fields to output config flags", () => {
    const template: UserTranslationTemplate = {
      name: "Custom",
      fields: {
        synonyms: true,
        examples: true,
        alternatives: false,
        equivalentNote: true,
        connotationWarning: false,
      },
    };

    expect(templateToOutputConfig(template)).toEqual({
      includeSynonyms: true,
      includeExamples: true,
      includeAlternatives: false,
      includeEquivalentNote: true,
      includeUsageNote: true,
      includeConnotationWarning: false,
      includeNativeSynonyms: true,
    });
  });
});

describe("resolveOutputConfig", () => {
  it("returns sentence output for sentence input regardless of user template", () => {
    const template: UserTranslationTemplate = {
      name: "Custom",
      fields: {
        synonyms: true,
        examples: true,
        alternatives: true,
        equivalentNote: true,
        connotationWarning: true,
      },
    };

    expect(resolveOutputConfig(template, "sentence")).toEqual(SENTENCE_OUTPUT);
  });

  it("returns default config when user template is null for words and phrases", () => {
    const expected = {
      ...RELIABLE_OUTPUT,
      includeSynonyms: true,
      includeAlternatives: true,
      includeNativeSynonyms: true,
    };
    expect(resolveOutputConfig(null, "word")).toEqual(expected);
    expect(resolveOutputConfig(null, "phrase")).toEqual(expected);
  });

  it("returns custom config for word and phrase input", () => {
    const template: UserTranslationTemplate = {
      name: "Custom",
      fields: {
        synonyms: true,
        examples: false,
        alternatives: true,
        equivalentNote: false,
        connotationWarning: true,
      },
    };

    const expected = templateToOutputConfig(template);
    expect(resolveOutputConfig(template, "word")).toEqual(expected);
    expect(resolveOutputConfig(template, "phrase")).toEqual(expected);
  });
});

describe("resolveTemplate", () => {
  it("returns DEFAULT_TEMPLATE when input is null", () => {
    expect(resolveTemplate(null)).toEqual(DEFAULT_TEMPLATE);
  });

  it("returns the custom template as-is when provided", () => {
    const custom: UserTranslationTemplate = {
      name: "My Custom",
      fields: {
        synonyms: false,
        examples: true,
        alternatives: false,
        equivalentNote: true,
        connotationWarning: false,
      },
    };

    expect(resolveTemplate(custom)).toBe(custom);
  });
});
