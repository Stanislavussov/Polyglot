import { describe, expect, it } from "vitest";
import { applyTemplateFields, TEMPLATE_PREVIEW_OUTPUT } from "../template-preview.js";
import { DEFAULT_TEMPLATE } from "../translation-template.types.js";

const allOn = { synonyms: true, examples: true, alternatives: true, equivalentNote: true, connotationWarning: true };
const allOff = {
  synonyms: false,
  examples: false,
  alternatives: false,
  equivalentNote: false,
  connotationWarning: false,
};

describe("applyTemplateFields", () => {
  it("keeps every section when every field is on", () => {
    expect(applyTemplateFields(TEMPLATE_PREVIEW_OUTPUT, allOn)).toEqual(TEMPLATE_PREVIEW_OUTPUT);
  });

  it("drops the sections the template turns off, keeping the translation itself", () => {
    const card = applyTemplateFields(TEMPLATE_PREVIEW_OUTPUT, allOff);
    const ru = card.translations.ru;

    expect(ru?.text).toBe("яблоко");
    expect(ru?.synonyms).toEqual([]);
    expect(ru?.examples).toEqual([]);
    expect(ru?.alternatives).toEqual([]);
    expect(ru?.connotationWarning).toBeUndefined();
    expect(card.nativeSynonyms).toEqual([]);
  });

  it("follows the default template: examples and warnings on, synonyms off", () => {
    const ru = applyTemplateFields(TEMPLATE_PREVIEW_OUTPUT, DEFAULT_TEMPLATE.fields).translations.ru;

    expect(ru?.examples).toHaveLength(3);
    expect(ru?.connotationWarning).toBeDefined();
    expect(ru?.synonyms).toEqual([]);
  });
});
