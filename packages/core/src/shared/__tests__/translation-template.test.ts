import { describe, expect, it } from "vitest";
import { SENTENCE_OUTPUT } from "../translation-output.presets.js";
import {
  MAX_TRANSCRIPTION_INPUT_LENGTH,
  resolveOutputConfig,
  resolveTemplate,
} from "../translation-template.service.js";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_FIELD_KEYS,
  templateToOutputConfig,
  type UserTranslationTemplate,
} from "../translation-template.types.js";

// ---------------------------------------------------------------------------
// DEFAULT_TEMPLATE
// ---------------------------------------------------------------------------
describe("DEFAULT_TEMPLATE", () => {
  it("has name 'Default'", () => {
    expect(DEFAULT_TEMPLATE.name).toBe("Default");
  });

  it("has all 6 fields set to true", () => {
    const { fields } = DEFAULT_TEMPLATE;
    expect(fields.transcription).toBe(true);
    expect(fields.synonyms).toBe(true);
    expect(fields.examples).toBe(true);
    expect(fields.alternatives).toBe(true);
    expect(fields.equivalentNote).toBe(true);
    expect(fields.connotationWarning).toBe(true);
  });

  it("has exactly 6 field keys", () => {
    expect(Object.keys(DEFAULT_TEMPLATE.fields)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// TEMPLATE_FIELD_KEYS
// ---------------------------------------------------------------------------
describe("TEMPLATE_FIELD_KEYS", () => {
  it("contains all 6 field keys", () => {
    expect(TEMPLATE_FIELD_KEYS).toHaveLength(6);
    expect(TEMPLATE_FIELD_KEYS).toContain("transcription");
    expect(TEMPLATE_FIELD_KEYS).toContain("synonyms");
    expect(TEMPLATE_FIELD_KEYS).toContain("examples");
    expect(TEMPLATE_FIELD_KEYS).toContain("alternatives");
    expect(TEMPLATE_FIELD_KEYS).toContain("equivalentNote");
    expect(TEMPLATE_FIELD_KEYS).toContain("connotationWarning");
  });

  it("has wizard display order: transcription → synonyms → examples → alternatives → equivalentNote → connotationWarning", () => {
    expect(TEMPLATE_FIELD_KEYS).toEqual([
      "transcription",
      "synonyms",
      "examples",
      "alternatives",
      "equivalentNote",
      "connotationWarning",
    ]);
  });
});

// ---------------------------------------------------------------------------
// templateToOutputConfig()
// ---------------------------------------------------------------------------
describe("templateToOutputConfig", () => {
  it("converts default template to config matching FULL_OUTPUT pattern", () => {
    const config = templateToOutputConfig(DEFAULT_TEMPLATE);
    expect(config.includeExamples).toBe(true);
    expect(config.includeTranscription).toBe(true);
    expect(config.includeSynonyms).toBe(true);
    expect(config.includeAlternatives).toBe(true);
    expect(config.includeEquivalentNote).toBe(true);
    expect(config.includeConnotationWarning).toBe(true);
    // System-controlled flag is always false
  });

  it("maps examples: false → includeExamples: false", () => {
    const template: UserTranslationTemplate = {
      name: "No Examples",
      fields: { ...DEFAULT_TEMPLATE.fields, examples: false },
    };
    const config = templateToOutputConfig(template);
    expect(config.includeExamples).toBe(false);
    // Other fields still true
    expect(config.includeTranscription).toBe(true);
    expect(config.includeSynonyms).toBe(true);
  });

  it("maps synonyms: false → includeSynonyms: false", () => {
    const template: UserTranslationTemplate = {
      name: "No Synonyms",
      fields: { ...DEFAULT_TEMPLATE.fields, synonyms: false },
    };
    expect(templateToOutputConfig(template).includeSynonyms).toBe(false);
  });

  it("maps transcription: false → includeTranscription: false", () => {
    const template: UserTranslationTemplate = {
      name: "No IPA",
      fields: { ...DEFAULT_TEMPLATE.fields, transcription: false },
    };
    expect(templateToOutputConfig(template).includeTranscription).toBe(false);
  });

  it("maps alternatives: false → includeAlternatives: false", () => {
    const template: UserTranslationTemplate = {
      name: "No Alts",
      fields: { ...DEFAULT_TEMPLATE.fields, alternatives: false },
    };
    expect(templateToOutputConfig(template).includeAlternatives).toBe(false);
  });

  it("maps equivalentNote: false → includeEquivalentNote: false", () => {
    const template: UserTranslationTemplate = {
      name: "No Notes",
      fields: { ...DEFAULT_TEMPLATE.fields, equivalentNote: false },
    };
    expect(templateToOutputConfig(template).includeEquivalentNote).toBe(false);
  });

  it("maps connotationWarning: false → includeConnotationWarning: false", () => {
    const template: UserTranslationTemplate = {
      name: "No Warnings",
      fields: { ...DEFAULT_TEMPLATE.fields, connotationWarning: false },
    };
    expect(templateToOutputConfig(template).includeConnotationWarning).toBe(false);
  });

  it("with all fields false → all include flags false (except system-controlled)", () => {
    const template: UserTranslationTemplate = {
      name: "Minimal",
      fields: {
        transcription: false,
        synonyms: false,
        examples: false,
        alternatives: false,
        equivalentNote: false,
        connotationWarning: false,
      },
    };
    const config = templateToOutputConfig(template);
    expect(config.includeExamples).toBe(false);
    expect(config.includeTranscription).toBe(false);
    expect(config.includeSynonyms).toBe(false);
    expect(config.includeAlternatives).toBe(false);
    expect(config.includeEquivalentNote).toBe(false);
    expect(config.includeConnotationWarning).toBe(false);
  });

  it("uses system defaults for default template", () => {
    const config = templateToOutputConfig(DEFAULT_TEMPLATE);
    expect(config.includeNativeSynonyms).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveOutputConfig()
// ---------------------------------------------------------------------------
describe("resolveOutputConfig", () => {
  it("returns SENTENCE_OUTPUT for sentence input regardless of user template", () => {
    const customTemplate: UserTranslationTemplate = {
      name: "Custom",
      fields: { ...DEFAULT_TEMPLATE.fields, examples: false },
    };
    const config = resolveOutputConfig(customTemplate, "sentence");
    expect(config).toEqual(SENTENCE_OUTPUT);
  });

  it("returns SENTENCE_OUTPUT for sentence input when user template is null", () => {
    const config = resolveOutputConfig(null, "sentence");
    expect(config).toEqual(SENTENCE_OUTPUT);
  });

  it("returns default config when user template is null and input is word", () => {
    const config = resolveOutputConfig(null, "word");
    // Should match templateToOutputConfig(DEFAULT_TEMPLATE)
    expect(config.includeExamples).toBe(true);
    expect(config.includeTranscription).toBe(true);
    expect(config.includeSynonyms).toBe(true);
    expect(config.includeAlternatives).toBe(true);
    expect(config.includeEquivalentNote).toBe(true);
    expect(config.includeConnotationWarning).toBe(true);
    expect(config.includeNativeSynonyms).toBe(true);
  });

  it("returns custom config when user template is set and input is word", () => {
    const customTemplate: UserTranslationTemplate = {
      name: "Custom",
      fields: {
        ...DEFAULT_TEMPLATE.fields,
        synonyms: false,
        examples: false,
      },
    };
    const config = resolveOutputConfig(customTemplate, "word");
    expect(config.includeSynonyms).toBe(false);
    expect(config.includeExamples).toBe(false);
    // Other fields still true
    expect(config.includeTranscription).toBe(true);
    expect(config.includeAlternatives).toBe(true);
  });

  it("returns custom config for phrase input (same as word)", () => {
    const customTemplate: UserTranslationTemplate = {
      name: "Custom",
      fields: { ...DEFAULT_TEMPLATE.fields, alternatives: false },
    };
    const config = resolveOutputConfig(customTemplate, "phrase");
    expect(config.includeAlternatives).toBe(false);
    expect(config.includeExamples).toBe(true);
  });

  it("phrase and word behave identically with same template", () => {
    const customTemplate: UserTranslationTemplate = {
      name: "Custom",
      fields: {
        ...DEFAULT_TEMPLATE.fields,
        transcription: false,
        connotationWarning: false,
      },
    };
    const wordConfig = resolveOutputConfig(customTemplate, "word");
    const phraseConfig = resolveOutputConfig(customTemplate, "phrase");
    expect(wordConfig).toEqual(phraseConfig);
  });

  it("returns default config for phrase with null template", () => {
    const config = resolveOutputConfig(null, "phrase");
    expect(config.includeExamples).toBe(true);
    expect(config.includeTranscription).toBe(true);
  });

  // inputLength-based transcription disabling
  it("disables transcription when inputLength > MAX_TRANSCRIPTION_INPUT_LENGTH", () => {
    const config = resolveOutputConfig(null, "word", MAX_TRANSCRIPTION_INPUT_LENGTH + 1);
    expect(config.includeTranscription).toBe(false);
  });

  it("keeps transcription when inputLength <= MAX_TRANSCRIPTION_INPUT_LENGTH", () => {
    const config = resolveOutputConfig(null, "word", MAX_TRANSCRIPTION_INPUT_LENGTH);
    expect(config.includeTranscription).toBe(true);
  });

  it("disables transcription for sentence with long input", () => {
    const config = resolveOutputConfig(null, "sentence", 100);
    expect(config.includeTranscription).toBe(false);
    // Other SENTENCE_OUTPUT fields remain
    expect(config.includeExamples).toBe(false);
    expect(config.includeSynonyms).toBe(false);
  });

  it("keeps transcription when inputLength is not provided", () => {
    const config = resolveOutputConfig(null, "word");
    expect(config.includeTranscription).toBe(true);
  });

  it("MAX_TRANSCRIPTION_INPUT_LENGTH is 45", () => {
    expect(MAX_TRANSCRIPTION_INPUT_LENGTH).toBe(45);
  });
});

// ---------------------------------------------------------------------------
// resolveTemplate()
// ---------------------------------------------------------------------------
describe("resolveTemplate", () => {
  it("returns DEFAULT_TEMPLATE when input is null", () => {
    const result = resolveTemplate(null);
    expect(result).toEqual(DEFAULT_TEMPLATE);
    expect(result.name).toBe("Default");
  });

  it("returns the custom template as-is when provided", () => {
    const custom: UserTranslationTemplate = {
      name: "My Custom",
      fields: {
        transcription: true,
        synonyms: false,
        examples: true,
        alternatives: false,
        equivalentNote: true,
        connotationWarning: false,
      },
    };
    const result = resolveTemplate(custom);
    expect(result).toEqual(custom);
    expect(result.name).toBe("My Custom");
    expect(result.fields.synonyms).toBe(false);
  });

  it("returns the same reference when custom template provided (pass-through)", () => {
    const custom: UserTranslationTemplate = {
      name: "Same Ref",
      fields: { ...DEFAULT_TEMPLATE.fields },
    };
    const result = resolveTemplate(custom);
    expect(result).toBe(custom);
  });
});
