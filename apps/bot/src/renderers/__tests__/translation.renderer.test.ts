import type { TemplateFields, TranslateOutput } from "@polyglot/core";
import { createLanguageOrderContext } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { renderTranslation as renderTranslationRaw } from "../translation.renderer.js";

/** Single-language fixtures — these assert content, not language sequence. */
const NO_ORDER = createLanguageOrderContext({ learningLangs: [] });
const renderTranslation = (
  output: TranslateOutput,
  interfaceLang?: string,
  templateFields?: TemplateFields,
  nativeLang?: string,
  needsReview?: boolean,
): string => renderTranslationRaw(output, NO_ORDER, interfaceLang, templateFields, nativeLang, needsReview);

/** Minimal word-translation output for renderer tests. */
function makeOutput(overrides?: Partial<TranslateOutput>): TranslateOutput {
  return {
    original: "stroha",
    sourceLang: "cs",
    emoji: "🌾",
    nativeSynonyms: [],
    translations: {
      en: {
        text: "husk",
        synonyms: [],
        examples: [{ context: "neutral", target: "A dry husk." }],
      },
    },
    ...overrides,
  };
}

describe("renderTranslation — unverified caveat (Task 70)", () => {
  it("renders the caveat line for an unverified (translate-as-written) card", () => {
    const card = renderTranslation(makeOutput({ unverified: true }), "en");
    expect(card).toContain("translated literally");
  });

  it("omits the caveat for a normal card", () => {
    const card = renderTranslation(makeOutput(), "en");
    expect(card).not.toContain("translated literally");
  });
});

describe("renderTranslation — canonical source headword (die Arbeit)", () => {
  /** A learning-source (de→ru) card: renderSourceUsageBlock owns the headword. */
  function learningSourceOutput(headword?: string | null): TranslateOutput {
    return {
      original: "arbeit",
      sourceLang: "de",
      emoji: "💼",
      nativeSynonyms: [],
      sourceUsage: {
        headword,
        explanation: "Работа, труд.",
        synonyms: [{ text: "die Tätigkeit" }],
        examples: [{ context: "daily", target: "Die Arbeit macht Spaß.", native: "Работа приносит удовольствие." }],
      },
      translations: {
        ru: { text: "работа", synonyms: [], examples: [] },
      },
    };
  }

  it("renders the canonical headword when the model supplied one", () => {
    const card = renderTranslation(learningSourceOutput("die Arbeit"), "en", undefined, "ru");
    expect(card).toContain("<b>die Arbeit</b>");
    expect(card).not.toContain("<b>arbeit</b>");
  });

  it("falls back to the raw input when no headword is present", () => {
    const card = renderTranslation(learningSourceOutput(undefined), "en", undefined, "ru");
    expect(card).toContain("<b>arbeit</b>");
  });
});
